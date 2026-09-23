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

/** Public-release discovery on the chosen update channel; Android still confirms installation of a verified, same-signer APK. */
final class UpdateManager {
    private static final ExecutorService IO=Executors.newSingleThreadExecutor();
    private static final String RELEASES="https://github.com/"+UpdateChannels.REPOSITORY+"/releases/download/";
    private static final OkHttpClient HTTP=new OkHttpClient.Builder().callTimeout(90,TimeUnit.SECONDS).followSslRedirects(false).build();
    private final Context context;private final Activity activity;private File pending;private String pendingTag;private boolean pendingSwitch;private Dialog resultDialog;
    private final java.util.concurrent.atomic.AtomicBoolean checkingBusy=new java.util.concurrent.atomic.AtomicBoolean(),downloadBusy=new java.util.concurrent.atomic.AtomicBoolean();
    UpdateManager(Context context){this.context=context.getApplicationContext();this.activity=context instanceof Activity?(Activity)context:null;}
    private SharedPreferences preferences(){return context.getSharedPreferences("app-updates",0);}
    /** The persisted channel name; anything unreadable follows production. */
    String channel(){String name=preferences().getString("channel","main");return UpdateChannels.publishable(name)?name:"main";}
    /** The release tag of an installed versionName, e.g. 0.1.0-beta.31.ch.moukrea.9.2. */
    static String installedTag(String versionName){String tag="android-v"+versionName;if(!UpdateChannels.parse(tag).component.equals("android"))throw new IllegalArgumentException("Invalid Android release version");return tag;}
    private String installed()throws Exception{return installedTag(context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionName);}
    private static final class Missing extends IOException{Missing(){super("Update channel document missing");}}
    /** The channel's androidRelease; a sub-channel's document must satisfy the contract before anything is trusted. */
    private String release(String channel)throws Exception{
        byte[] body;try{body=fetch(UpdateChannels.documentUrl(channel),16384);}catch(HttpStatus e){if(e.code==404&&!channel.equals("main"))throw new Missing();throw e;}
        JSONObject document=new JSONObject(new String(body,java.nio.charset.StandardCharsets.UTF_8));
        if(!channel.equals("main"))UpdateChannels.validateDocument(document,channel);
        String tag=document.optString("androidRelease");if(!UpdateChannels.parse(tag).component.equals("android"))throw new IOException("Not an Android release");
        return tag;
    }
    /** The raw channel list for the channel menu, which validates it (web/js/channels.mjs); the WebView itself cannot fetch it. */
    JSONObject channelIndex()throws Exception{return new JSONObject(new String(fetch(UpdateChannels.INDEX,1048576),java.nio.charset.StandardCharsets.UTF_8));}
    private static final class HttpStatus extends IOException{final int code;HttpStatus(int code){super("Release download failed (HTTP "+code+")");this.code=code;}}
    private byte[] fetch(String url,int maximum)throws Exception{return fetch(url,maximum,null);}
    private byte[] fetch(String url,int maximum,java.util.function.BiConsumer<Integer,Long> progress)throws Exception{
        Request req=new Request.Builder().url(url).header("Cache-Control","no-cache").header("User-Agent","jaunt Android updater").build();
        try(Response response=HTTP.newCall(req).execute()){
            if(!response.isSuccessful()||response.body()==null)throw new HttpStatus(response.code());
            ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[16384];int n;
            try(InputStream in=response.body().byteStream()){while((n=in.read(buffer))!=-1){if(out.size()+n>maximum)throw new IOException("Release exceeds size limit");out.write(buffer,0,n);if(progress!=null)progress.accept(out.size(),response.body().contentLength());}}
            return out.toByteArray();
        }
    }
    void check(boolean explicit){check(explicit,false);}
    /** startup: every launch checks the published version and offers the update; later foregrounds are throttled. */
    void check(boolean explicit,boolean startup){
        if(context.getPackageName().endsWith(".debug"))return;
        long now=System.currentTimeMillis();if(!explicit&&!startup&&now-preferences().getLong("checked",0)<6*60*60*1000L)return;
        if(downloadBusy.get()||!checkingBusy.compareAndSet(false,true))return;
        preferences().edit().putLong("checked",now).apply();
        final ProgressDialog checking=explicit&&activity!=null?new ProgressDialog(activity):null;
        if(checking!=null){checking.setMessage(Lang.t("Checking published Android version…"));checking.setCancelable(false);checking.show();}
        IO.execute(()->{try{
            String channel=channel(),current=installed();
            // The owner publishes these documents only after checking the public APK assets.
            // No per-user GitHub API account or shared-IP API quota is required.
            String tag=release(channel);
            // No automatic update crosses a channel: only a newer release of the chosen one is offered.
            if(!UpdateChannels.automatic(channel,current,tag)){if(explicit)message("jaunt is up to date",Lang.t("You already have the latest published Android release."));return;}
            if(activity==null){notifyAvailable(tag);return;}
            activity.runOnUiThread(()->{if(!activity.isFinishing()&&!activity.isDestroyed()){if(resultDialog!=null)resultDialog.dismiss();resultDialog=new AlertDialog.Builder(activity).setTitle(Lang.t("jaunt update available")).setMessage(Lang.format("Version {0} is available. Your paired machines will be kept. Android will ask you to confirm installation.",tag.substring(9))).setNegativeButton(Lang.t("Ignore"),null).setPositiveButton(Lang.t("Update"),(d,w)->download(tag,false)).show();}});
        }catch(Missing e){channelMissing();
        }catch(Exception e){if(explicit)message(Lang.t("Update check unavailable"),Lang.t("Could not verify the latest release. Check your connection and try again."));}finally{checkingBusy.set(false);if(checking!=null)activity.runOnUiThread(checking::dismiss);}});
    }
    /** The explicit switch: only a person changing the setting may install a release that is not newer. */
    void switchChannel(String name){
        if(!"main".equals(name)&&!UpdateChannels.publishable(name))throw new IllegalArgumentException(Lang.t("Unknown update channel name"));
        if(context.getPackageName().endsWith(".debug"))throw new IllegalStateException(Lang.t("Updates are disabled in this debug build."));
        if(activity==null||downloadBusy.get()||!checkingBusy.compareAndSet(false,true))throw new IllegalStateException(Lang.t("Update in progress…"));
        preferences().edit().putString("channel",name).apply();
        ProgressDialog checking=new ProgressDialog(activity);checking.setMessage(Lang.t("Checking published Android version…"));checking.setCancelable(false);checking.show();
        IO.execute(()->{try{
            String current=installed(),tag=release(name);
            if(tag.equals(current)){message(Lang.t("Update channel"),Lang.t("This channel's version is already installed."));return;}
            // A comparable target that is not newer has a lower versionCode: Android would refuse it, so explain before downloading.
            boolean older;try{older=UpdateChannels.compare(tag,current)<0;}catch(UpdateChannels.NotComparable e){older=false;}
            if(older){olderBuild(name);return;}
            activity.runOnUiThread(()->download(tag,true));
        }catch(Missing e){channelMissing();
        }catch(Exception e){message(Lang.t("Update check unavailable"),Lang.t("Could not verify the latest release. Check your connection and try again."));}finally{checkingBusy.set(false);activity.runOnUiThread(checking::dismiss);}});
    }
    /** A removed channel keeps the installed version and offers main; it never switches by itself. */
    private void channelMissing(){
        if(activity!=null)activity.runOnUiThread(()->{if(!activity.isFinishing()&&!activity.isDestroyed()){if(resultDialog!=null)resultDialog.dismiss();resultDialog=new AlertDialog.Builder(activity).setTitle(Lang.t("This update channel no longer exists")).setMessage(Lang.t("This update channel no longer exists. The installed version is kept; switch back to main to follow production.")).setNegativeButton(Lang.t("Later"),null).setPositiveButton(Lang.t("Return to main"),(d,w)->{try{switchChannel("main");}catch(Exception e){message(Lang.t("Update check unavailable"),e.getMessage());}}).show();}});
    }
    /** Android cannot install a lower versionCode, so a switch to an older build is explained instead of failing. */
    private void olderBuild(String channel){
        message(Lang.t("Android cannot install an older build"),"main".equals(channel)
            ?Lang.t("jaunt returns to production automatically with the next production release. To return now, uninstall and reinstall jaunt: its data on this phone, including pairings, is lost.")
            :Lang.t("Choose this channel again once it publishes a newer build, or uninstall and reinstall jaunt: its data on this phone, including pairings, is lost."));
    }
    private void notifyAvailable(String tag){
        NotificationManager manager=context.getSystemService(NotificationManager.class);manager.createNotificationChannel(new NotificationChannel("jaunt-updates",Lang.t("Application updates"),NotificationManager.IMPORTANCE_DEFAULT));
        Intent intent=new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("checkUpdate",true);
        PendingIntent open=PendingIntent.getActivity(context,77,intent,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        manager.notify(2,new Notification.Builder(context,"jaunt-updates").setSmallIcon(R.drawable.ic_jaunt).setContentTitle("jaunt update available").setContentText(Lang.format("Tap to install {0}. Your pairings will be kept.",tag.substring(9))).setContentIntent(open).setAutoCancel(true).build());
    }
    private void download(String tag,boolean switching){
        if(!downloadBusy.compareAndSet(false,true))return;
        ProgressDialog progress=new ProgressDialog(activity);progress.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);progress.setMax(100);progress.setIndeterminate(true);progress.setMessage(Lang.t("Downloading jaunt…"));progress.setCancelable(false);progress.show();
        IO.execute(()->{try{
            String base=RELEASES+tag+"/",name="jaunt-"+tag+".apk";String sums=new String(fetch(base+"SHA256SUMS",16384),java.nio.charset.StandardCharsets.UTF_8),expected=null;
            for(String row:sums.split("\\n")){String[] parts=row.trim().split("  ",2);if(parts.length==2&&parts[1].equals(name)&&parts[0].matches("[a-f0-9]{64}"))expected=parts[0];}
            if(expected==null)throw new IOException("APK checksum missing");
            java.util.concurrent.atomic.AtomicInteger shown=new java.util.concurrent.atomic.AtomicInteger(-1);
            byte[] apk=fetch(base+name,64*1024*1024,(bytes,total)->{
                int percent=total>0?(int)(bytes*100L/total):-1;
                if(shown.getAndSet(percent)!=percent)activity.runOnUiThread(()->{progress.setIndeterminate(total<=0);if(total>0)progress.setProgress(percent);progress.setMessage(Lang.t("Downloading jaunt · ")+(bytes/1024)+" KiB");});
            });
            activity.runOnUiThread(()->{progress.setIndeterminate(true);progress.setMessage(Lang.t("Verifying checksum and application signature…"));});
            if(!hex(MessageDigest.getInstance("SHA-256").digest(apk)).equals(expected))throw new IOException("APK checksum mismatch");
            File dir=new File(context.getCacheDir(),"updates");if(!dir.exists()&&!dir.mkdirs())throw new IOException("No update directory");File file=new File(dir,"jaunt-update.apk");
            try(FileOutputStream out=new FileOutputStream(file)){out.write(apk);out.getFD().sync();}
            verifyPackage(file,tag,switching);pending=file;pendingTag=tag;pendingSwitch=switching;activity.runOnUiThread(()->{progress.dismiss();installPending();});
        }catch(Downgrade e){activity.runOnUiThread(progress::dismiss);olderBuild(channel());
        }catch(Exception e){activity.runOnUiThread(progress::dismiss);message(Lang.t("Update was not installed"),Lang.t("The download or its signature could not be verified. Your current app and pairings are unchanged. Try again later."));}finally{downloadBusy.set(false);}});
    }
    private static String hex(byte[] data){StringBuilder out=new StringBuilder();for(byte b:data)out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();}
    private static final class Downgrade extends SecurityException{Downgrade(){super("Version downgrade");}}
    /** Binds the APK to the chosen release tag; only an explicit switch may install a release that is not newer. */
    @SuppressWarnings("deprecation") private void verifyPackage(File apk,String tag,boolean switching)throws Exception{
        PackageManager pm=context.getPackageManager();int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
        PackageInfo own=pm.getPackageInfo(context.getPackageName(),flags),next=pm.getPackageArchiveInfo(apk.getAbsolutePath(),flags);
        if(next==null||!own.packageName.equals(next.packageName)||!tag.equals(installedTag(next.versionName))||!switching&&!UpdateChannels.automatic(channel(),installedTag(own.versionName),tag))throw new SecurityException("Invalid application update");
        long oldCode=Build.VERSION.SDK_INT>=28?own.getLongVersionCode():own.versionCode,newCode=Build.VERSION.SDK_INT>=28?next.getLongVersionCode():next.versionCode;
        if(!UpdateChannels.switchAllowed(oldCode,newCode))throw new Downgrade();
        android.content.pm.Signature[] a=Build.VERSION.SDK_INT>=28?own.signingInfo.getApkContentsSigners():own.signatures,b=Build.VERSION.SDK_INT>=28?next.signingInfo.getApkContentsSigners():next.signatures;
        if(a.length!=1||b.length!=1||!MessageDigest.isEqual(a[0].toByteArray(),b[0].toByteArray()))throw new SecurityException("Signing identity changed");
    }
    void installPending(){if(pending==null||activity==null)return;
        if(!context.getPackageManager().canRequestPackageInstalls()){
            new AlertDialog.Builder(activity).setTitle(Lang.t("Allow this update")).setMessage(Lang.t("Android needs permission for jaunt to open its APK installer. Enable “Allow from this source”, then return here.")).setNegativeButton(Lang.t("Later"),null).setPositiveButton(Lang.t("Open Android settings"),(d,w)->activity.startActivityForResult(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+context.getPackageName())),44)).show();return;
        }
        try{verifyPackage(pending,pendingTag,pendingSwitch);Uri uri=FileProvider.getUriForFile(context,context.getPackageName()+".updates",pending);activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));}catch(Exception e){message(Lang.t("Could not open the update"),Lang.t("Please check for updates again. Your current installation is unchanged."));}
    }
    private void message(String title,String text){if(activity!=null)activity.runOnUiThread(()->{if(!activity.isFinishing()&&!activity.isDestroyed()){if(resultDialog!=null)resultDialog.dismiss();resultDialog=new AlertDialog.Builder(activity).setTitle(Lang.t(title)).setMessage(text).setPositiveButton("OK",null).show();}});}
}
