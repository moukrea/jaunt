[English](../../../SEAMLESS_WORKSPACE_VALIDATION.md) · [fr](../../fr/docs/SEAMLESS_WORKSPACE_VALIDATION.md) · [es](../../es/docs/SEAMLESS_WORKSPACE_VALIDATION.md) · [it](../../it/docs/SEAMLESS_WORKSPACE_VALIDATION.md) · [pt](../../pt/docs/SEAMLESS_WORKSPACE_VALIDATION.md) · [de](SEAMLESS_WORKSPACE_VALIDATION.md)

# Validierung von Workspace- und Laufzeitupdates — 2026-09-15

Die öffentlichen Versionen wurden geprüft: Host `0.1.0b11`, Desktop `0.1.0-beta.10` und Android `0.1.0-beta.8`. In einer isolierten Ubuntu-VM wurden die öffentliche Seite, Prüfsummen, der offizielle Installer und der Benutzerdienst geprüft. Echte WebSocket-Verbindung, Shell-Befehle, bytegenau verglichene Übertragungen, Wiederverbindung und Widerruf waren erfolgreich. Die reine Client-Installation in einem neuen Konto legte weder CLI noch Host-Dienst an. Das native Desktop-Update von 9 auf 10 behielt die PIDs des Hosts und der Shells bei; ein Befehl wurde davor und danach ausgeführt. Android 7 wurde im Emulator auf 8 aktualisiert und behielt die Kopplung. Wiederholte Prüfungen enden mit einem einzigen Dialog, der den aktuellen Versionsstand bestätigt.

## Beobachtete Ergebnisse

Befehl | Beobachtetes Ergebnis |
| --- | --- |
| `.venv/bin/python -m pytest -q` | 77 Tests bestanden, einschließlich echter Vordergrund-PTY Programmübergänge. |
| `npm test` | 30 Tests bestanden. |
| `npm run test:relay` | Beide aktuellen Miniflare / Workerd WebSocket Szenarien bestanden. |
| `.venv/bin/python scripts/check_project.py` | Python/JavaScript Syntax, lokale Importe, Seitenressourcen und Installer-Syntax übergeben. |
| `.venv/bin/python tests/browser_e2e.py` | 23 Szenarien bestanden mit echten PTYs, Authentifizierung, Reconnects, Byte-Vergleichen, Clipboard-Fallback und Widerruf. |
| `jaunt_E2E_RELAY=workerd .venv/bin/python tests/browser_e2e.py` | Die gleichen 23 Szenarien durchliefen die eigentliche Worker-Implementierung. |
| `.venv/bin/python tests/terminal_render_e2e.py` | Echte isolierte `claude` und `codex` Startup, ihre Meteor-Tab / Panel-Symbole, terminal Dimensionen, Auswahl und Scroll-to-latest übergeben.
| `DISPLAY=:179 .venv/bin/python tests/shared_workspace_e2e.py` | Electron und Browser teilten sich ein PTY, das Eigentum an Dimensionen, Sitzungskontrollen und persistenten Split-Gruppen bestanden. |
| `.venv/bin/python tests/feedback_e2e.py` | Unterbrochene Handshakes/RPCs, begrenztes Kontext-Feedback, Fortschrittskontrollen und Wechsel zwischen echten Hosts bestanden. |
| `.venv/bin/python tests/workspace_usability_e2e.py` | Stabile Tab-Positionen, Pointer-Reorder, Doppelklick-Rename, kein Long-Press-Rename, gespeicherter Sidebar-Status, responsive Einstellungen und beibehaltener mobiler Scroll-Anker übergeben. |
| `.venv/bin/python tests/i18n_e2e.py` | Sechs Browser-Locales, explizit gespeicherte Overrides und sechs CLI-Hilfesprachen bestanden; Befehlsargumente und wörtliche Benutzerdaten blieben unverändert. |
| `.venv/bin/python tests/handoff_e2e.py` | Aktuelle Laufzeit `exec` zurückbehaltener Daemon/PTY PIDs, Environment, CWD und Browser Befehlsausführung. shell könnte noch beendet werden. |
| `.venv/bin/python scripts/build_release.py` dann `.venv/bin/python tests/installer_e2e.py` | Ein installiertes Rad ersetzte seine Laufzeit, während es ein echtes shell am Leben erhielt. Identitäts- und Gerätedatensätze blieben intakt; kein Account Service Manager wurde berührt. |
| `jaunt_LEGACY_RELEASE_DIR=<verified public beta.10 assets> .venv/bin/python tests/installer_e2e.py` | Der echte öffentliche Legacy-Host weigerte sich, mit einem aktiven shell zu migrieren. Expliziter Neustart dieses isolierten Geräts schloss es und bewahrte die Identität / Geräte. |
| `DISPLAY=:179 .venv/bin/python tests/client_only_e2e.py` | Aktuell Electron Client-Only-Modus ohne lokale CLI Anrufe; gepaart über das bereitgestellte Besitzerrelay und ausgeführt ein Befehl auf einem isolierten Remote-Host. `jaunt` Fenstertitel übergeben. |
| `npm audit --omit=optional` | Keine Schwachstellen gemeldet. |
| `.venv/bin/python -m pip_audit` | Keine bekannten Abhängigkeitslücken. Das lokal installierte Projekt selbst ist keine PyPI-auditierbare Verteilung. |
| Android Gradle Release/Debug Builds, Unit-Tests und Flusen | Passed nach dem Ersetzen eines API-33-only-Stream-Helfers durch eine Leseschleife, die mit der minimalen API 26 kompatibel ist.

Das native Client-only-Szenario verwendet das tatsächliche WSS-Relay des Besitzers, da ein unsicheres Loopback-Relay nicht von einem verpackten Anwendungs-Ursprung akzeptiert werden darf. Sein Host-Zustand und shell sind temporäre Testvorrichtungen. In diesem Bericht ist kein Paarungsmaterial enthalten.

## Prüfung der veröffentlichten Versionen

Die öffentlichen Versionen wurden geprüft: Host `0.1.0b11`, Desktop `0.1.0-beta.10` und Android `0.1.0-beta.8`. In einer isolierten Ubuntu-VM wurden die öffentliche Seite, Prüfsummen, der offizielle Installer und der Benutzerdienst geprüft. Echte WebSocket-Verbindung, Shell-Befehle, bytegenau verglichene Übertragungen, Wiederverbindung und Widerruf waren erfolgreich. Die reine Client-Installation in einem neuen Konto legte weder CLI noch Host-Dienst an. Das native Desktop-Update von 9 auf 10 behielt die PIDs des Hosts und der Shells bei; ein Befehl wurde davor und danach ausgeführt. Android 7 wurde im Emulator auf 8 aktualisiert und behielt die Kopplung. Wiederholte Prüfungen enden mit einem einzigen Dialog, der den aktuellen Versionsstand bestätigt.

Der kompatible Austausch der Host-11-Laufzeit behielt Prozesse und Identität bei. Es war eine Neuinstallation derselben Version. Der alte Host 10 benötigt weiterhin eine erste geschützte Migration: Seine aktiven Shells können nicht rückwirkend erhalten werden. Keine persönliche Shell wurde beendet. Es wurde kein physisches Telefon benutzt: Kamera, Galerie, Benachrichtigungen bei gesperrtem Bildschirm und Wechsel zwischen WLAN und Mobilfunk sind noch ungeprüft. Das Protokoll hat kein unabhängiges Sicherheitsaudit erhalten.

[https://moukrea.github.io/jaunt/](https://moukrea.github.io/jaunt/) · [English — public release verification](../../../SEAMLESS_WORKSPACE_VALIDATION.md#public-release-verification)
