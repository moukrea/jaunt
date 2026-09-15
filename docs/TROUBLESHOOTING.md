# Troubleshooting

| Symptom | Diagnosis and action |
|---|---|
| “Relay has not been deployed” | The page still contains `relay:null`. Complete the owner deployment. Do not substitute a fictional URL. |
| `jaunt` not found after installation | Open a new shell or use `~/.local/bin/jaunt`. Add `~/.local/bin` to PATH if your shell configuration excludes it. |
| `curl (23)` while downloading configuration | curl could not write the received data. The installer stages on the runtime filesystem instead of `/tmp`, opens download files in Bash, and retries curl write failures through Python. Actual exhaustion or write denial on the installation filesystem still causes a storage error. See [installer validation](INSTALLER_FEDORA.md). |
| Consumed or expired QR code | On a remembered device, open the host card instead of reusing the old QR code. For a new device, run `jaunt pair`. |
| Host offline | Check `jaunt status`, outbound WSS/443 connectivity, sleep/hibernation, and `jaunt doctor`. No new QR code is needed. |
| User service unavailable | `jaunt start` runs in the background. Configure a real user service for startup after reboot. On Linux, running while logged out also depends on systemd linger, which may require an administrator. |
| Update refused | Ordinary PTYs are active. Finish them, or explicitly use `JAUNT_ALLOW_RESTART=1` and accept their termination. tmux is recommended for long-running tasks. |
| Camera denied or missing | Allow camera access on HTTPS, select a QR image file, or paste the complete code. Manual entry does not depend on the camera. |
| Image not recognized as an agent attachment | Upload-plus-path works without a graphical desktop. Native paste requires a host clipboard and a CLI tool that reads it. See README; there is no universal headless attachment driver. |
| No push notification | Check registration in Settings, browser permission, an installed PWA if required, outbound connectivity to the push service, and `jaunt notify`. Notifications are not automatically generated for every shell application. |
| Large file rejected | The host limit is 512 MiB; in-memory downloads are limited to 128 MiB. Use direct file writing if offered by the browser. This limit helps avoid killing a mobile tab. |
| Lost PIN | There is no recovery backdoor. Reset the local vault, pair again, and revoke the old identity on the host. |
| Reconnected but task disappeared | The daemon/OS restarted; an ordinary PTY was a child of that daemon. Use tmux to survive daemon restarts. |
| Copied text truncated | History is bounded: 2 MiB on the host, 10,000 lines on the client. Redirect long output to a file and download it. |
| Relay 429 response | The project has its own relay, but this does not guarantee immunity from quotas or abuse. Check Cloudflare metrics, connection counts, and room limits. |

Host logs must not contain secrets. Never attach `host.json`, a QR code, an IndexedDB export, or a confidential file to a public report. To uninstall, run `jaunt service uninstall`, then `jaunt stop`, then remove runtime binaries. Delete the state directory only after intentional backup/revocation: it contains identities and attachments.
