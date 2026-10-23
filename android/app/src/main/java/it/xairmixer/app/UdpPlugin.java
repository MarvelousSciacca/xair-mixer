package it.xairmixer.app;

import android.util.Base64;
import android.view.WindowManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * UDP per l'app Android: fa quello che nel browser fa il ponte Node (server/bridge.js).
 * Un solo socket su porta casuale; i pacchetti ricevuti arrivano al JavaScript come evento
 * "packet" { host, data (base64) }. La codifica OSC resta in JavaScript (public/js/osc.js).
 */
@CapacitorPlugin(name = "XAirUdp")
public class UdpPlugin extends Plugin {

    private DatagramSocket socket;
    private Thread receiver;
    private final ExecutorService sender = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void open(PluginCall call) {
        try {
            ensureOpen();
            JSObject ret = new JSObject();
            ret.put("port", socket.getLocalPort());
            call.resolve(ret);
        } catch (SocketException e) {
            call.reject("Socket UDP non disponibile: " + e.getMessage());
        }
    }

    @PluginMethod
    public void send(PluginCall call) {
        final String host = call.getString("host");
        final int port = call.getInt("port", 10024);
        final String data = call.getString("data");
        if (host == null || data == null) {
            call.reject("host e data sono obbligatori");
            return;
        }
        try {
            ensureOpen();
        } catch (SocketException e) {
            call.reject("Socket UDP non disponibile: " + e.getMessage());
            return;
        }
        final byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
        // la rete non va usata sul thread principale; un solo thread mantiene l'ordine dei pacchetti
        sender.execute(() -> {
            try {
                socket.send(new DatagramPacket(bytes, bytes.length, InetAddress.getByName(host), port));
            } catch (Exception ignored) {
                // UDP è "best effort", come nel ponte Node
            }
        });
        call.resolve();
    }

    /** Indirizzi di broadcast delle reti attive, più 255.255.255.255. */
    @PluginMethod
    public void broadcastAddresses(PluginCall call) {
        Set<String> out = new LinkedHashSet<>();
        out.add("255.255.255.255");
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress b = ia.getBroadcast();
                    if (b != null) out.add(b.getHostAddress());
                }
            }
        } catch (SocketException ignored) {
            // si usa solo il broadcast generico
        }
        JSObject ret = new JSObject();
        ret.put("addresses", new JSArray(out));
        call.resolve(ret);
    }

    /** Schermo sempre acceso mentre si è collegati al mixer (on: true/false). */
    @PluginMethod
    public void keepAwake(PluginCall call) {
        final boolean on = call.getBoolean("on", true);
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        closeSocket();
        call.resolve();
    }

    private synchronized void ensureOpen() throws SocketException {
        if (socket != null && !socket.isClosed()) return;
        socket = new DatagramSocket();
        socket.setBroadcast(true);
        final DatagramSocket s = socket;
        receiver = new Thread(() -> {
            byte[] buf = new byte[65535];
            while (!s.isClosed()) {
                try {
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    s.receive(p);
                    JSObject ev = new JSObject();
                    ev.put("host", p.getAddress().getHostAddress());
                    ev.put("data", Base64.encodeToString(p.getData(), p.getOffset(), p.getLength(), Base64.NO_WRAP));
                    notifyListeners("packet", ev);
                } catch (Exception e) {
                    if (s.isClosed()) break;
                }
            }
        }, "xair-udp");
        receiver.setDaemon(true);
        receiver.start();
    }

    private synchronized void closeSocket() {
        if (socket != null) socket.close();
        socket = null;
    }

    @Override
    protected void handleOnDestroy() {
        closeSocket();
        sender.shutdownNow();
    }
}
