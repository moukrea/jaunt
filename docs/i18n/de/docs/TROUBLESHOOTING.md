[English](../../../TROUBLESHOOTING.md) · [fr](../../fr/docs/TROUBLESHOOTING.md) · [es](../../es/docs/TROUBLESHOOTING.md) · [it](../../it/docs/TROUBLESHOOTING.md) · [pt](../../pt/docs/TROUBLESHOOTING.md) · [de](TROUBLESHOOTING.md)

# Fehlerbehebung

| Symptom | Diagnose und Aktion |
|---|---|
| „Relay wurde nicht bereitgestellt | Die Seite enthält immer noch `relay:null`. Vervollständigen Sie die Bereitstellung des Besitzers. Ersetzen Sie keine fiktive URL. |
| `jaunt` nach der Installation nicht gefunden | Öffnen Sie ein neues shell oder verwenden Sie `~/.local/bin/jaunt`. Fügen Sie `~/.local/bin` zu PATH hinzu, wenn Ihre shell-Konfiguration es ausschließt. |
| `curl (23)` beim Herunterladen der Konfiguration | curl konnte die empfangenen Daten nicht schreiben. Der Installer-Phasen auf dem Laufzeitdateisystem anstelle von `/tmp` öffnen Download-Dateien in Bash und wiederholt Curl-Schreibfehler durch Python. Tatsächliche Erschöpfung oder Schreibverweigerung auf dem Installationsdateisystem verursacht immer noch einen Speicherfehler. Siehe [installer validation](INSTALLER_FEDORA.md). |
Verbraucht oder abgelaufen QR Code | Öffnen Sie auf einem erinnerten Gerät die Hostkarte, anstatt das alte wiederzuverwenden QR Code. Für ein neues Gerät ausführen `jaunt pair`. |
| Host offline | Überprüfen Sie `jaunt status`, ausgehende WSS/443-Konnektivität, Schlaf / Ruhezustand und `jaunt doctor`. Es wird kein neuer QR-Code benötigt. |
| Benutzerdienst nicht verfügbar | `jaunt start` läuft im Hintergrund. Konfigurieren Sie einen echten Benutzerdienst für den Start nach dem Neustart. Auf Linux hängt das Ausführen während des Ausloggens auch von systemd linger ab, was möglicherweise einen Administrator erfordert. |
Gewöhnliche PTYs sind aktiv. Beenden Sie sie oder verwenden Sie explizit `jaunt_ALLOW_RESTART=1` und akzeptieren Sie ihre Beendigung. tmux wird für lang laufende Aufgaben empfohlen. |
| Kamera verweigert oder fehlt | Kamerazugriff auf HTTPS zulassen, eine QR-Bilddatei auswählen oder den kompletten Code einfügen. Manuelle Eingabe hängt nicht von der Kamera ab. |
| Bild, das nicht als Agent-Anhang erkannt wird | Upload-plus-Pfad funktioniert ohne grafischen Desktop. Native Paste erfordert eine Host-Zwischenablage und ein CLI-Tool, das es liest. Siehe README; es gibt keinen universellen Headless-Anhangtreiber. |
| Keine Push-Benachrichtigung | Überprüfen Sie die Registrierung in den Einstellungen, die Browserberechtigung, eine installierte PWA, falls erforderlich, die ausgehende Konnektivität zum Push-Dienst und `jaunt notify`. Benachrichtigungen werden nicht automatisch für jede shell-Anwendung generiert. |
| Große Datei abgelehnt | Das Host-Limit ist 512 MiB; In-Memory-Downloads sind auf 128 MiB beschränkt. Verwenden Sie direktes Dateischreiben, wenn es vom Browser angeboten wird.
| Verlorene PIN | Es gibt keine Wiederherstellungs-Backdoor. Setzen Sie das lokale Gewölbe zurück, koppeln Sie es erneut und widerrufen Sie die alte Identität auf dem Host. |
Der Daemon / OS wurde neu gestartet; ein gewöhnlicher PTY war ein Kind dieses Daemons. Verwenden Sie tmux, um Daemon-Neustarts zu überleben.
| Kopierter Text abgeschnitten | Geschichte ist begrenzt: 2 MiB auf dem Host, 10.000 Zeilen auf dem Client. Redirect long output to a file and download it. |
| Relais 429 Antwort | Das Projekt hat ein eigenes Relais, aber das garantiert keine Immunität von Quoten oder Missbrauch. Überprüfen Sie Cloudflare Metriken, Verbindungszahlen und Raumlimits. |

Hostprotokolle dürfen keine Geheimnisse enthalten. Fügen Sie niemals `host.json`, einen QR-Code, einen IndexedDB-Export oder eine vertrauliche Datei an einen öffentlichen Bericht an. Führen Sie zum Deinstallieren `jaunt service uninstall`, dann `jaunt stop` aus und entfernen Sie dann Laufzeitbinärdateien. Löschen Sie das Zustandsverzeichnis nur nach absichtlicher Sicherung / Widerruf: Es enthält Identitäten und Anhänge.
