import Foundation
import Capacitor
import Darwin

/// UDP per l'app iOS: stessa interfaccia del plugin Android (UdpPlugin.java).
/// Un solo socket su porta casuale; i pacchetti ricevuti arrivano al JavaScript come evento
/// "packet" { host, data (base64) }. La codifica OSC resta in JavaScript (public/js/osc.js).
/// Nota: su iOS il broadcast richiede un permesso speciale di Apple; per trovare il mixer
/// il JavaScript usa anche `interfaces` e interroga gli indirizzi della rete uno per uno.
@objc(UdpPlugin)
public class UdpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "UdpPlugin"
    public let jsName = "XAirUdp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "broadcastAddresses", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "interfaces", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
    ]

    private var fd: Int32 = -1
    private let lock = NSLock()
    private let sendQueue = DispatchQueue(label: "xair-udp-send")

    @objc func open(_ call: CAPPluginCall) {
        guard ensureOpen() else {
            call.reject("Socket UDP non disponibile")
            return
        }
        call.resolve()
    }

    @objc func send(_ call: CAPPluginCall) {
        guard let host = call.getString("host"),
              let b64 = call.getString("data"),
              let bytes = Data(base64Encoded: b64) else {
            call.reject("host e data sono obbligatori")
            return
        }
        let port = UInt16(call.getInt("port") ?? 10024)
        guard ensureOpen() else {
            call.reject("Socket UDP non disponibile")
            return
        }
        let s = fd
        // un solo thread di invio mantiene l'ordine dei pacchetti
        sendQueue.async {
            var addr = sockaddr_in()
            addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
            addr.sin_family = sa_family_t(AF_INET)
            addr.sin_port = port.bigEndian
            guard inet_pton(AF_INET, host, &addr.sin_addr) == 1 else { return }
            bytes.withUnsafeBytes { raw in
                withUnsafePointer(to: &addr) { ptr in
                    ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                        // UDP è "best effort": gli errori di rete si ignorano, come nel ponte Node
                        _ = sendto(s, raw.baseAddress, bytes.count, 0, sa, socklen_t(MemoryLayout<sockaddr_in>.size))
                    }
                }
            }
        }
        call.resolve()
    }

    @objc func broadcastAddresses(_ call: CAPPluginCall) {
        var out = ["255.255.255.255"]
        for item in ipv4Interfaces() {
            if let b = item["broadcast"], !out.contains(b) { out.append(b) }
        }
        call.resolve(["addresses": out])
    }

    /// Reti IPv4 attive: nome (en0 = Wi-Fi), indirizzo, maschera.
    @objc func interfaces(_ call: CAPPluginCall) {
        call.resolve(["interfaces": ipv4Interfaces()])
    }

    @objc func close(_ call: CAPPluginCall) {
        closeSocket()
        call.resolve()
    }

    deinit {
        closeSocket()
    }

    // MARK: - socket

    private func ensureOpen() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if fd >= 0 { return true }
        let s = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        if s < 0 { return false }
        var yes: Int32 = 1
        setsockopt(s, SOL_SOCKET, SO_BROADCAST, &yes, socklen_t(MemoryLayout<Int32>.size))
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0
        addr.sin_addr.s_addr = INADDR_ANY
        let bound = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                bind(s, sa, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        if bound != 0 {
            Darwin.close(s)
            return false
        }
        fd = s
        let receiver = Thread { [weak self] in self?.receiveLoop(s) }
        receiver.name = "xair-udp"
        receiver.start()
        return true
    }

    private func receiveLoop(_ s: Int32) {
        var buf = [UInt8](repeating: 0, count: 65535)
        while true {
            var from = sockaddr_in()
            var len = socklen_t(MemoryLayout<sockaddr_in>.size)
            let n = withUnsafeMutablePointer(to: &from) { ptr in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                    recvfrom(s, &buf, buf.count, 0, sa, &len)
                }
            }
            if n < 0 {
                if errno == EINTR { continue }
                break // socket chiuso
            }
            var ip = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            var a = from.sin_addr
            inet_ntop(AF_INET, &a, &ip, socklen_t(INET_ADDRSTRLEN))
            let data = Data(buf[0..<n]).base64EncodedString()
            notifyListeners("packet", data: ["host": String(cString: ip), "data": data])
        }
    }

    private func closeSocket() {
        lock.lock()
        defer { lock.unlock() }
        if fd >= 0 {
            Darwin.close(fd)
            fd = -1
        }
    }

    // MARK: - reti

    private func ipString(_ sa: UnsafeMutablePointer<sockaddr>?) -> String? {
        guard let sa = sa else { return nil }
        return sa.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { sin in
            var addr = sin.pointee.sin_addr
            var buf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            return inet_ntop(AF_INET, &addr, &buf, socklen_t(INET_ADDRSTRLEN)) != nil ? String(cString: buf) : nil
        }
    }

    private func ipv4Interfaces() -> [[String: String]] {
        var out: [[String: String]] = []
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return out }
        defer { freeifaddrs(list) }
        for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let ifa = p.pointee
            guard let sa = ifa.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET) else { continue }
            let flags = Int32(ifa.ifa_flags)
            if flags & IFF_UP == 0 || flags & IFF_LOOPBACK != 0 { continue }
            var item: [String: String] = ["name": String(cString: ifa.ifa_name)]
            if let ip = ipString(ifa.ifa_addr) { item["ip"] = ip }
            if let mask = ipString(ifa.ifa_netmask) { item["netmask"] = mask }
            if flags & IFF_BROADCAST != 0, let b = ipString(ifa.ifa_dstaddr) { item["broadcast"] = b }
            out.append(item)
        }
        return out
    }
}

/// Controller principale: registra il plugin UDP e tiene lo schermo acceso.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(UdpPlugin())
        UIApplication.shared.isIdleTimerDisabled = true
    }
}
