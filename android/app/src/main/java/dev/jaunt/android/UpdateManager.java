package dev.jaunt.android;

import android.app.*;
import android.content.*;
import android.content.pm.*;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import okhttp3.*;
import org.json.*;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

/** Public-release discovery; Android still confirms installation of a verified, same-signer APK. */
final class UpdateManager {
    private static final ExecutorService IO=Executors.newSingleThreadExecutor();
    private static final String CHANNEL="https://moukrea.github.io/jaunt/config.json";
    private static final String RELEASES="https://github.com/moukrea/jaunt/releases/download/";
    private static final OkHttpClient HTTP=new OkHttpClient.Builder().callTimeout(90,TimeUnit.SECONDS).followSslRedirects(false).build();
    private final Context context;private final Activity activity;private File pending;
    UpdateManager(Context context){this.context=context.getApplicationContext();this.activity=context instanceof Activity?(Activity)context:null;}
    private SharedPreferences preferences(){return context.getSharedPreferences("app-updates",0);}
    static int[] version(String tag){
        java.util.regex.Matcher m=java.util.regex.Pattern.compile("(?:android-v)?(\\d+)\\.(\\d+)\\.(\\d+)(?:-(alpha|beta|rc)\\.(\\d+))?").matcher(tag);
        if(!m.matches())throw new IllegalArgumentException("Invalid Android release version");
        return new int[]{Integer.parseInt(m.group(1)),Integer.parseInt(m.group(2)),Integer.parseInt(m.group(3)),m.group(4)==null?3:List.of("alpha","beta","rc").indexOf(m.group(4)),m.group(5)==null?0:Integer.parseInt(m.group(5))};
    }
    static boolean newer(String candidate,String current){int[] a=version(candidate),b=version(current);for(int i=0;i<a.length;i++)if(a[i]!=b[i])return a[i]>b[i];return false;}
    private byte[] fetch(String url,int maximum)throws Exception{
        Request req=new Request.Builder().url(url).header("Cache-Control","no-cache").header("User-Agent","jaunt Android updater").build();
        try(Response response=HTTP.newCall(req).execute()){
            if(!response.isSuccessful()||response.body()==null)throw new IOException("Release download failed (HTTP "+response.code()+")");
            ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[16384];int n;
            try(InputStream in=response.body().byteStream()){while((n=in.read(buffer))!=-1){if(out.size()+n>maximum)throw new IOException("Release exceeds size limit");out.write(buffer,0,n);}}
            return out.toByteArray();
        }
    }
    void check(boolean explicit){
        if(context.getPackageName().endsWith(".debug"))return;
        long now=System.currentTimeMillis();if(!explicit&&now-preferences().getLong("checked",0)<6*60*60*1000L)return;
        preferences().edit().putLong("checked",now).apply();
        IO.execute(()->{try{
            String current=context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionName;
            // The owner publishes this channel only after checking the public APK assets.
            // No per-user GitHub API account or shared-IP API quota is required.
            JSONObject channel=new JSONObject(new String(fetch(CHANNEL,16384),java.nio.charset.StandardCharsets.UTF_8));
            String tag=channel.optString("androidRelease");
            if(tag.isEmpty()||!tag.startsWith("android-v")||!newer(tag,current)){if(explicit)message("jaunt is up to date","You already have the latest published Android release.");return;}
            String name="jaunt-"+tag+".apk";
            if(activity==null){notifyAvailable(tag);return;}
            activity.runOnUiThread(()->{if(!activity.isFinishing())new AlertDialog.Builder(activity).setTitle("jaunt update available").setMessage("Version "+tag.substring(9)+" is available. Your paired machines will be kept. Android will ask you to confirm installation.").setNegativeButton("Later",null).setPositiveButton("Download and install",(d,w)->download(tag,name)).show();});
        }catch(Exception e){if(explicit)message("Update check unavailable","Could not verify the latest release. Check your connection and try again.");}});
    }
    private void notifyAvailable(String tag){
        NotificationManager manager=context.getSystemService(NotificationManager.class);manager.createNotificationChannel(new NotificationChannel("jaunt-updates","Application updates",NotificationManager.IMPORTANCE_DEFAULT));
        Intent intent=new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("checkUpdate",true);
        PendingIntent open=PendingIntent.getActivity(context,77,intent,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        manager.notify(2,new Notification.Builder(context,"jaunt-updates").setSmallIcon(R.drawable.ic_jaunt).setContentTitle("jaunt update available").setContentText("Tap to install "+tag.substring(9)+". Your pairings will be kept.").setContentIntent(open).setAutoCancel(true).build());
    }
    private void download(String tag,String name){
        ProgressDialog progress=new ProgressDialog(activity);progress.setMessage("Downloading and verifying jaunt…");progress.setCancelable(false);progress.show();
        IO.execute(()->{try{
            String base=RELEASES+tag+"/";String sums=new String(fetch(base+"SHA256SUMS",16384),java.nio.charset.StandardCharsets.UTF_8),expected=null;
            for(String row:sums.split("\\n")){String[] parts=row.trim().split("  ",2);if(parts.length==2&&parts[1].equals(name)&&parts[0].matches("[a-f0-9]{64}"))expected=parts[0];}
            if(expected==null)throw new IOException("APK checksum missing");byte[] apk=fetch(base+name,64*1024*1024);
            if(!hex(MessageDigest.getInstance("SHA-256").digest(apk)).equals(expected))throw new IOException("APK checksum mismatch");
            File dir=new File(context.getCacheDir(),"updates");if(!dir.exists()&&!dir.mkdirs())throw new IOException("No update directory");File file=new File(dir,"jaunt-update.apk");
            try(FileOutputStream out=new FileOutputStream(file)){out.write(apk);out.getFD().sync();}
            verifyPackage(file);pending=file;activity.runOnUiThread(()->{progress.dismiss();installPending();});
        }catch(Exception e){activity.runOnUiThread(progress::dismiss);message("Update was not installed","The download or its signature could not be verified. Your current app and pairings are unchanged. Try again later.");}});
    }
    private static String hex(byte[] data){StringBuilder out=new StringBuilder();for(byte b:data)out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();}
    @SuppressWarnings("deprecation") private void verifyPackage(File apk)throws Exception{
        PackageManager pm=context.getPackageManager();int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
        PackageInfo own=pm.getPackageInfo(context.getPackageName(),flags),next=pm.getPackageArchiveInfo(apk.getAbsolutePath(),flags);
        if(next==null||!own.packageName.equals(next.packageName)||!newer(next.versionName,own.versionName))throw new SecurityException("Invalid application update");
        long oldCode=Build.VERSION.SDK_INT>=28?own.getLongVersionCode():own.versionCode,newCode=Build.VERSION.SDK_INT>=28?next.getLongVersionCode():next.versionCode;
        if(newCode<=oldCode)throw new SecurityException("Version downgrade");
        android.content.pm.Signature[] a=Build.VERSION.SDK_INT>=28?own.signingInfo.getApkContentsSigners():own.signatures,b=Build.VERSION.SDK_INT>=28?next.signingInfo.getApkContentsSigners():next.signatures;
        if(a.length!=1||b.length!=1||!MessageDigest.isEqual(a[0].toByteArray(),b[0].toByteArray()))throw new SecurityException("Signing identity changed");
    }
    void installPending(){if(pending==null||activity==null)return;
        if(!context.getPackageManager().canRequestPackageInstalls()){
            new AlertDialog.Builder(activity).setTitle("Allow this update").setMessage("Android needs permission for jaunt to open its APK installer. Enable “Allow from this source”, then return here.").setNegativeButton("Later",null).setPositiveButton("Open Android settings",(d,w)->activity.startActivityForResult(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+context.getPackageName())),44)).show();return;
        }
        try{verifyPackage(pending);Uri uri=FileProvider.getUriForFile(context,context.getPackageName()+".updates",pending);activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));}catch(Exception e){message("Could not open the update","Please check for updates again. Your current installation is unchanged.");}
    }
    private void message(String title,String text){if(activity!=null)activity.runOnUiThread(()->{if(!activity.isFinishing())new AlertDialog.Builder(activity).setTitle(title).setMessage(text).setPositiveButton("OK",null).show();});}
}
