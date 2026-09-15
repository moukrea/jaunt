"""Local UI messages; protocol fields, command arguments and terminal bytes stay intact."""
import json,locale,os,re
from pathlib import Path
from .state import state_dir,atomic_json
LANGUAGES=('en','fr','es','it','pt','de')
_catalog={};_language='en'
def configure(value=None):
    global _catalog,_language
    if value is None:
        value=os.environ.get('jaunt_LANGUAGE')
        if not value:
            try:value=json.loads((state_dir()/'language.json').read_text()).get('language')
            except (OSError,ValueError):pass
    if not value or value=='system':value=(os.environ.get('LC_ALL') or os.environ.get('LC_MESSAGES') or os.environ.get('LANG') or locale.getlocale()[0] or 'en').split('_')[0].split('-')[0]
    _language=value if value in LANGUAGES else 'en'
    try:_catalog=json.loads((Path(__file__).parent/'locales'/(_language+'.json')).read_text())
    except (OSError,ValueError):_catalog={}
    return _language

def save(value):
    if value not in (*LANGUAGES,'system'):raise ValueError('Unsupported language')
    atomic_json(state_dir()/'language.json',{'language':value});configure(value)

def tr(key,*values):
    text=_catalog.get(key,key)
    return re.sub(r'\{(\d+)\}',lambda m:str(values[int(m[1])]) if int(m[1])<len(values) else m[0],text)
configure()
