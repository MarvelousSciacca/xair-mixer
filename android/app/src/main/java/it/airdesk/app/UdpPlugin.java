package it.airdesk.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.util.Base64;
import android.view.WindowManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
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
 *
 * Il socket è legato alla rete Wi-Fi (o via cavo): la rete del mixer di solito non ha internet,
 * e in quel caso Android manda il traffico delle app sui dati mobili, dove il mixer non c'è.
 */
@CapacitorPlugin(name = "XAirUdp")
public class UdpPlugin extends Plugin {

    private DatagramSocket socket;
    private Thread receiver;
    private final ExecutorService sender = Executors.newSingleThreadExecutor();
    private Network localNetwork;
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override
    public void load() {
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;
        NetworkRequest req = new NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
            .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) // la rete del mixer può non avere internet
            .build();
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                setLocalNetwork(network);
            }

            @Override
            public void onLost(Network network) {
                if (network.equals(localNetwork)) setLocalNetwork(null);
            }
        };
        try {
            cm.registerNetworkCallback(req, networkCallback);
        } catch (RuntimeException e) {
            networkCallback = null;
        }
    }

    /** Cambio di rete locale: il socket va ricreato sulla rete nuova (la porta cambia, il mixer si riallinea con /xremote). */
    private synchronized void setLocalNetwork(Network network) {
        localNetwork = network;
        if (socket != null) {
            closeSocket();
            try {
                ensureOpen();
            } catch (SocketException ignored) {
                // verrà riaperto al prossimo invio
            }
        }
    }

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
        if (!allowedTarget(host, port)) {
            call.reject("Indirizzo non ammesso: solo la porta del mixer sulla rete locale");
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

    private static final int MIXER_PORT = 10024;

    /**
     * Solo indirizzi IPv4 della rete locale (broadcast compresi) e solo la porta OSC del mixer:
     * l'app non può essere usata per mandare pacchetti verso Internet.
     */
    static boolean allowedTarget(String host, int port) {
        if (port != MIXER_PORT || host == null || !host.matches("\\d{1,3}(\\.\\d{1,3}){3}")) return false;
        String[] p = host.split("\\.");
        int a = Integer.parseInt(p[0]), b = Integer.parseInt(p[1]);
        for (String part : p) if (Integer.parseInt(part) > 255) return false;
        if (host.equals("255.255.255.255")) return true;
        return a == 10 || a == 127 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168)
            || (a == 169 && b == 254) || (a == 100 && b >= 64 && b <= 127);
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

    /**
     * Interfacce IPv4 attive { name, ip, netmask }: se il broadcast non arriva al mixer
     * (alcuni router o reti lo filtrano), l'app interroga gli indirizzi della rete uno per uno.
     */
    @PluginMethod
    public void interfaces(PluginCall call) {
        JSArray list = new JSArray();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    if (!(ia.getAddress() instanceof Inet4Address)) continue;
                    int prefix = ia.getNetworkPrefixLength();
                    long mask = prefix == 0 ? 0 : (0xFFFFFFFFL << (32 - prefix)) & 0xFFFFFFFFL;
                    JSObject item = new JSObject();
                    item.put("name", ni.getName());
                    item.put("ip", ia.getAddress().getHostAddress());
                    item.put("netmask", ((mask >> 24) & 255) + "." + ((mask >> 16) & 255) + "." + ((mask >> 8) & 255) + "." + (mask & 255));
                    list.put(item);
                }
            }
        } catch (SocketException ignored) {
            // nessuna interfaccia: resta il broadcast
        }
        JSObject ret = new JSObject();
        ret.put("interfaces", list);
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
        if (localNetwork != null) {
            try {
                localNetwork.bindSocket(socket);
            } catch (IOException ignored) {
                // resta sulla rete predefinita
            }
        }
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
        if (networkCallback != null) {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            try {
                if (cm != null) cm.unregisterNetworkCallback(networkCallback);
            } catch (RuntimeException ignored) {
                // già rimosso
            }
        }
    }
}
