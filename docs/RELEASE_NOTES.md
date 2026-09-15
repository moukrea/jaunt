# jaunt 0.1.0-beta.12

This release makes updating a host from any client reliable. The host now pushes every update step to connected clients (checking, downloading, verifying, preparing, installing, replacing the runtime), announces the in-place runtime restart before it happens so clients show *Updating host · shells are kept* instead of an outage, and drains in-flight client actions itself before replacing the runtime. The version that is really running is the reference: an interrupted earlier attempt can no longer leave a host that reports "up to date" while still serving the old runtime. A failed runtime replacement points the installation back at the previous runtime and reports the installer's own reason; network failures are marked as retryable. Deferred updates (file transfers in progress) resume by themselves.

The installer skips the pip self-upgrade when the reviewed version is already present, retries dependency downloads, keeps the previous runtime for rollback and prunes older ones. `jaunt start` waits for a host that is replacing its runtime instead of spawning a competing daemon, and `jaunt service install` never starts a second daemon next to one started outside the user service.

French, Spanish, Italian, Portuguese and German interface text was rewritten as native UI copy across the web, desktop, Android and CLI surfaces.

Hosts already running an older release still perform their next update with the previous updater; the reworked behavior applies from this release onward. The protocol has not undergone an independent security audit. See [the validation report](HOST_UPDATE_VALIDATION.md) for observed tests and remaining limits.
