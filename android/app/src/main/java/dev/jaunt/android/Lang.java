package dev.jaunt.android;
import android.content.Context;
import org.json.JSONObject;
import java.util.Locale;
import java.nio.charset.StandardCharsets;
/** Shared bundled catalogs; never translate terminal output or user-supplied content. */
final class Lang {
 private static Context app;private static String loaded="";private static JSONObject catalog=new JSONObject();
 static void initialize(Context context){app=context.getApplicationContext();}
 static String language(){if(app==null)return Locale.getDefault().getLanguage();String value=app.getSharedPreferences("native",0).getString("language","system");return value.equals("system")?Locale.getDefault().getLanguage():value;}
 static void set(String language){if(!java.util.Arrays.asList("system","en","fr","es","it","pt","de").contains(language))throw new IllegalArgumentException("Unsupported language");app.getSharedPreferences("native",0).edit().putString("language",language).apply();loaded="";}
 static synchronized String t(String key){String language=language();if(!language.equals(loaded)){loaded=language;catalog=new JSONObject();if(app!=null&&!language.equals("en"))try(java.io.InputStream stream=app.getAssets().open("jaunt/locales/"+language+".json")){java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[8192];int count;while((count=stream.read(buffer))!=-1)bytes.write(buffer,0,count);catalog=new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));}catch(Exception ignored){}}return catalog.optString(key,key);}
 static String format(String key,Object... values){String result=t(key);for(int i=0;i<values.length;i++)result=result.replace("{"+i+"}",String.valueOf(values[i]));return result;}
}
