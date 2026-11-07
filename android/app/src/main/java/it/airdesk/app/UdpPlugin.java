package it.airdesk.app;

import android.content.Context;
import android.content.pm.PackageManager;
import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiManager;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiReceiver;
import android.net.ConnectivityManager;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.view.accessibility.AccessibilityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.util.Base64;
import android.os.Build;
import android.view.HapticFeedbackConstants;
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
import java.util.HashMap;
import java.util.Map;
import java.util.Locale;
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
    private TextToSpeech tts;
    private MidiManager midiManager;
    private final Map<Integer, MidiDevice> midiDevices = new HashMap<>();
    private final Map<Integer, String> midiNames = new HashMap<>();
    private boolean ttsReady = false;

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

    /**
     * Vibrazione sotto il dito mentre si muove un fader o una manopola: lo scatto della rotella
     * dell'orologio (CLOCK_TICK), più deciso sui punti di riferimento (strong: 0 dB, centro).
     * Rispetta l'impostazione "Vibrazione al tocco" del sistema; non serve nessun permesso.
     */
    @PluginMethod
    public void haptic(PluginCall call) {
        final boolean strong = call.getBoolean("strong", false);
        getActivity().runOnUiThread(() -> {
            int kind = HapticFeedbackConstants.CLOCK_TICK;
            if (strong) kind = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY;
            getBridge().getWebView().performHapticFeedback(kind);
        });
        call.resolve();
    }

    /** Guida vocale: dice un testo con la voce del sistema (text vuoto: smette di parlare). */
    @PluginMethod
    public void speak(PluginCall call) {
        final String text = call.getString("text", "");
        final String lang = call.getString("lang", "it-IT");
        final boolean flush = call.getBoolean("flush", true);
        if (tts == null) {
            tts = new TextToSpeech(getContext(), status -> {
                ttsReady = status == TextToSpeech.SUCCESS;
                if (ttsReady) say(text, lang, flush);
            });
        } else if (ttsReady) {
            say(text, lang, flush);
        }
        call.resolve();
    }

    private void say(String text, String lang, boolean flush) {
        if (text.isEmpty()) {
            tts.stop();
            return;
        }
        tts.setLanguage(Locale.forLanguageTag(lang));
        tts.setSpeechRate(1.1f);
        tts.speak(text, flush ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, "airdesk");
    }

    /** TalkBack (o un altro lettore che esplora col tocco) è acceso? */
    @PluginMethod
    public void screenReader(PluginCall call) {
        AccessibilityManager am = (AccessibilityManager) getContext().getSystemService(Context.ACCESSIBILITY_SERVICE);
        JSObject ret = new JSObject();
        ret.put("on", am != null && am.isEnabled() && am.isTouchExplorationEnabled());
        call.resolve(ret);
    }

    // --- MIDI: controller USB (e Bluetooth già associati) ----------------------------------------
    // Ogni dispositivo con porte d'uscita (dati dal controller verso l'app) viene aperto; i byte
    // arrivano al JavaScript come evento "midi" { id, data: [byte…] } e l'elenco dei controller
    // come "midiInputs" { inputs: [{ id, name }] }. midi-native.js ne fa un accesso Web MIDI.

    /** Avvia il MIDI e restituisce i controller collegati (inputs: [{ id, name }]). */
    @PluginMethod
    public void midiStart(PluginCall call) {
        if (!getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_MIDI)) {
            call.reject("MIDI non disponibile su questo dispositivo");
            return;
        }
        if (midiManager == null) {
            midiManager = (MidiManager) getContext().getSystemService(Context.MIDI_SERVICE);
            if (midiManager == null) {
                call.reject("MIDI non disponibile su questo dispositivo");
                return;
            }
            midiManager.registerDeviceCallback(new MidiManager.DeviceCallback() {
                @Override
                public void onDeviceAdded(MidiDeviceInfo info) {
                    openMidi(info);
                }

                @Override
                public void onDeviceRemoved(MidiDeviceInfo info) {
                    closeMidi(info.getId());
                    sendMidiInputs();
                }
            }, new Handler(Looper.getMainLooper()));
            for (MidiDeviceInfo info : midiDevicesList()) openMidi(info);
        }
        JSObject ret = new JSObject();
        ret.put("inputs", midiInputs());
        call.resolve(ret);
    }

    @SuppressWarnings("deprecation")
    private MidiDeviceInfo[] midiDevicesList() {
        return midiManager.getDevices();
    }

    private void openMidi(MidiDeviceInfo info) {
        if (info.getOutputPortCount() == 0 || midiDevices.containsKey(info.getId())) return;
        String name = info.getProperties().getString(MidiDeviceInfo.PROPERTY_NAME);
        if (name == null) name = info.getProperties().getString(MidiDeviceInfo.PROPERTY_PRODUCT);
        final String label = name != null ? name : "MIDI";
        final int id = info.getId();
        midiManager.openDevice(info, device -> {
            if (device == null) return;
            synchronized (midiDevices) {
                midiDevices.put(id, device);
                midiNames.put(id, label);
            }
            for (int i = 0; i < info.getOutputPortCount(); i++) {
                MidiOutputPort port = device.openOutputPort(i);
                if (port == null) continue;
                port.connect(new MidiReceiver() {
                    @Override
                    public void onSend(byte[] msg, int offset, int count, long timestamp) {
                        JSArray data = new JSArray();
                        for (int k = 0; k < count; k++) data.put(msg[offset + k] & 0xff);
                        JSObject ev = new JSObject();
                        ev.put("id", id);
                        ev.put("data", data);
                        notifyListeners("midi", ev);
                    }
                });
            }
            sendMidiInputs();
        }, new Handler(Looper.getMainLooper()));
    }

    private void closeMidi(int id) {
        MidiDevice d;
        synchronized (midiDevices) {
            d = midiDevices.remove(id);
            midiNames.remove(id);
        }
        if (d != null) {
            try {
                d.close();
            } catch (IOException ignored) {
                // già chiuso
            }
        }
    }

    private JSArray midiInputs() {
        JSArray list = new JSArray();
        synchronized (midiDevices) {
            for (Map.Entry<Integer, String> e : midiNames.entrySet()) {
                JSObject o = new JSObject();
                o.put("id", e.getKey());
                o.put("name", e.getValue());
                list.put(o);
            }
        }
        return list;
    }

    private void sendMidiInputs() {
        JSObject ev = new JSObject();
        ev.put("inputs", midiInputs());
        notifyListeners("midiInputs", ev);
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
        if (tts != null) tts.shutdown();
        for (Integer id : new java.util.ArrayList<>(midiDevices.keySet())) closeMidi(id);
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
