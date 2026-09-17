"""jaunt host. Sessions are independent of the browser and relay connection."""
__version__ = "0.1.0b37"

# Accept existing installations' environment names while using lowercase branding.
import os as _os
for _key, _value in tuple(_os.environ.items()):
    if _key.lower().startswith('jaunt_'):
        _canonical = 'jaunt_' + _key[6:]
        _os.environ.setdefault(_canonical, _value)
