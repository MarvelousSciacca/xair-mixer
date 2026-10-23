# Informativa sulla privacy di AirDesk

Ultimo aggiornamento: 23 ottobre 2026

AirDesk è un'app per controllare un mixer digitale dalla rete locale. È sviluppata da MarvelousSciacca
(di seguito "lo sviluppatore") ed è distribuita gratuitamente con licenza MIT.

## In breve

**AirDesk non raccoglie, non invia e non vende alcun dato personale.** Non ci sono account, pubblicità,
statistiche d'uso, sistemi di tracciamento o segnalazione automatica degli errori, e lo sviluppatore non
gestisce server che ricevano dati dall'app.

## Comunicazioni di rete

- L'app comunica **solo con il mixer sulla rete locale** (Wi-Fi o cavo), con il protocollo OSC sulla porta
  UDP 10024. Per trovare il mixer manda una richiesta a tutti i dispositivi della rete locale.
- L'app non si collega a Internet. Il ponte dell'app per computer accetta solo indirizzi della rete locale
  e solo la pagina dell'app stessa.
- Le informazioni scambiate con il mixer sono le impostazioni audio (livelli, nomi e colori dei canali,
  effetti, scene) e restano tra il tuo dispositivo e il tuo mixer.

## Dati salvati sul dispositivo

Restano solo sul tuo dispositivo e non vengono mai inviati allo sviluppatore:

- preferenze dell'app: tema, vista, layer, canali protetti, ultimo indirizzo IP del mixer usato;
- le scene che salvi tu come file, nella cartella che scegli.

Per cancellarli basta disinstallare l'app o cancellarne i dati dalle impostazioni del sistema. Sull'app
Android il backup automatico dei dati è disattivato.

## Permessi

- **Rete locale** (iOS) e **Internet** (Android): servono per parlare con il mixer sulla rete locale.
  Su Android il permesso si chiama "Internet" anche quando la comunicazione resta nella rete locale.
- **Schermo sempre acceso**: mentre sei collegato al mixer lo schermo non si spegne da solo.

L'app non usa microfono, fotocamera, posizione, contatti, foto o notifiche.

## Minori

L'app non raccoglie dati, quindi nemmeno dati di minori.

## Modifiche e contatti

Eventuali modifiche a questa informativa saranno pubblicate in questo file, con la data aggiornata.
Per domande: apri una segnalazione ("Issue") nel repository GitHub del progetto,
https://github.com/MarvelousSciacca/xair-mixer.

---

# AirDesk Privacy Policy

Last updated: October 23, 2026

AirDesk is an app for controlling a digital mixer over the local network. It is developed by
MarvelousSciacca ("the developer") and distributed free of charge under the MIT license.

**AirDesk does not collect, transmit or sell any personal data.** There are no accounts, ads, usage
analytics, trackers or automatic crash reports, and the developer runs no servers that receive data from
the app.

- **Network:** the app talks only to the mixer on your local network (OSC over UDP port 10024) and sends a
  discovery request to the devices on that network. It does not connect to the Internet. The data exchanged
  are mixer settings (levels, channel names and colors, effects, scenes) and stay between your device and
  your mixer.
- **Data stored on your device:** app preferences (theme, view, layers, protected channels, last mixer IP
  address) and the scene files you save yourself. They never leave your device; uninstalling the app or
  clearing its data removes them. Android automatic backup is disabled.
- **Permissions:** local network (iOS) and Internet (Android, required even for local-network traffic), to
  reach the mixer; keeping the screen awake while connected. No microphone, camera, location, contacts,
  photos or notifications.
- **Children:** no data is collected from anyone, including children.
- **Changes and contact:** changes will be published in this file with an updated date. Questions: open an
  issue in the project's GitHub repository, https://github.com/MarvelousSciacca/xair-mixer.
