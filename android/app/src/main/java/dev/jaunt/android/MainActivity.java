package dev.jaunt.android;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.webkit.*;
import android.view.*;
import androidx.webkit.*;
import com.google.zxing.integration.android.*;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

/** Bundled UI, origin-restricted native capabilities; external pages never receive a bridge. */
public class MainActivity extends Activity {
    static final String ORIGIN="https://moukrea.github.io", HOME=ORIGIN+"/jaunt/";
    private WebView web;
    private UpdateManager updater;
    private android.widget.TextView loading;
    private final Handler mainHandler=new Handler(Looper.getMainLooper());
    private boolean appReady;
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private final Map<String,InputStream> reads=new HashMap<>();
    private final Map<String,OutputStream> writes=new HashMap<>();
    private ValueCallback<Uri[]> chooser;
    private Reply scanReply,saveReply,notificationReply;
    private JSONObject notificationMachine;
    private Uri sharedImage;
    private boolean foreground;
    interface Reply { void done(Object value, String error); }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);updater=new UpdateManager(this);
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::goBack);
        web=new WebView(this);
        android.widget.FrameLayout frame=new android.widget.FrameLayout(this);frame.addView(web,new android.widget.FrameLayout.LayoutParams(-1,-1));
        loading=new android.widget.TextView(this);loading.setText("Opening Jaunt…");loading.setTextColor(0xffeeeeee);loading.setBackgroundColor(0xff121314);loading.setGravity(Gravity.CENTER);frame.addView(loading,new android.widget.FrameLayout.LayoutParams(-1,-1));setContentView(frame);
        mainHandler.postDelayed(()->{if(!appReady&&!isFinishing()){loading.setText("Jaunt could not open. Tap to retry.");loading.setOnClickListener(v->recreate());}},20000);
        web.setOnApplyWindowInsetsListener((v,insets)->{
            if(Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.ime());v.setPadding(bars.left,bars.top,bars.right,bars.bottom);}
            return insets;
        });
        WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(true);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        WebViewAssetLoader.AssetsPathHandler bundled=new WebViewAssetLoader.AssetsPathHandler(this);
        WebViewAssetLoader assets=new WebViewAssetLoader.Builder().setDomain("moukrea.github.io")
            .addPathHandler("/jaunt/",path -> bundled.handle("jaunt/"+(path.isEmpty()?"index.html":path))).build();
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView view,String url){view.postInvalidateOnAnimation();}
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){
                view.destroy();web=null;
                new AlertDialog.Builder(MainActivity.this).setTitle("Reopen your workspace").setMessage("Android closed the display to free memory. Your shells are still running on the host.").setPositiveButton("Reconnect",(d,w)->recreate()).setCancelable(false).show();return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest req){
                WebResourceResponse result=assets.shouldInterceptRequest(req.getUrl());
                if(result!=null)return result;
                // A missing bundled import must fail closed, never silently fetch another release.
                return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Map.of(),new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest req){
                Uri uri=req.getUrl();
                if(isHome(uri))return false;
                if(req.isForMainFrame() && ("https".equals(uri.getScheme())||"http".equals(uri.getScheme())))startActivity(new Intent(Intent.ACTION_VIEW,uri));
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(chooser!=null)chooser.onReceiveValue(null);chooser=callback;
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                String[] accept=params.getAcceptTypes();if(accept.length>0&&!accept[0].isEmpty())intent.putExtra(Intent.EXTRA_MIME_TYPES,accept);
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);
                startActivityForResult(intent,40);return true;
            }
        });
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)){
            new AlertDialog.Builder(this).setTitle("Update Android System WebView").setMessage("Jaunt needs a current Android System WebView to safely connect its native functions.").setPositiveButton("Close",(d,w)->finish()).show();return;
        }
        WebViewCompat.addWebMessageListener(web,"JauntNative",Set.of(ORIGIN),(view,message,origin,main,proxy)->{
            if(!main||!ORIGIN.equals(origin.toString()))return;
            try{
                JSONObject request=new JSONObject(message.getData());String id=request.getString("id");
                Reply reply=(value,error)->runOnUiThread(()->{try{proxy.postMessage(new JSONObject().put("id",id).put("value",value==null?JSONObject.NULL:value).put("error",error==null?JSONObject.NULL:error).toString());}catch(Exception ignored){}});
                dispatch(request.getString("method"),request.optJSONObject("params")==null?new JSONObject():request.getJSONObject("params"),reply);
            }catch(Exception ignored){ /* Malformed/untrusted bridge input has no side effect. */ }
        });
        acceptIntent(getIntent());web.loadUrl(HOME);
    }
    private static boolean isHome(Uri uri){return "https".equals(uri.getScheme())&&"moukrea.github.io".equals(uri.getHost())&&uri.getPath()!=null&&uri.getPath().startsWith("/jaunt/");}
    @Override protected void onResume(){super.onResume();foreground=true;NotificationService.uiVisible=true;if(appReady)updater.check(false); }
    @Override protected void onPause(){foreground=false;NotificationService.uiVisible=false;super.onPause();}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);acceptIntent(intent);if(intent.getBooleanExtra("checkUpdate",false))updater.check(true);if(web!=null)web.evaluateJavascript("window.dispatchEvent(new Event('jaunt-native-open'))",null);}
    @SuppressWarnings("deprecation") private void acceptIntent(Intent intent){if(Intent.ACTION_SEND.equals(intent.getAction()))sharedImage=intent.getParcelableExtra(Intent.EXTRA_STREAM);}
    private void dispatch(String method,JSONObject p,Reply reply){
        try{
            switch(method){
                case "app.ready":appReady=true;loading.setVisibility(View.GONE);web.postInvalidateOnAnimation();reply.done(true,null);updater.check(getIntent().getBooleanExtra("checkUpdate",false));getIntent().removeExtra("checkUpdate");return;
                case "app.updates":updater.check(true);reply.done(true,null);return;
                case "clipboard.read":{
                    if(!foreground)throw new SecurityException("Open Jaunt before reading the clipboard.");
                    ClipboardManager manager=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);ClipData clip=manager.getPrimaryClip();
                    if(clip==null||clip.getItemCount()==0){reply.done(new JSONObject().put("text",""),null);return;}
                    ClipData.Item item=clip.getItemAt(0);Uri uri=item.getUri();
                    if(uri!=null && "content".equals(uri.getScheme())){String type=getContentResolver().getType(uri);if(type!=null&&type.startsWith("image/")){openRead(uri,type,reply);return;}}
                    reply.done(new JSONObject().put("text",item.coerceToText(this).toString()),null);return;
                }
                case "clipboard.write":((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("Jaunt",p.getString("text")));reply.done(true,null);return;
                case "shared.read":{Uri uri=sharedImage;sharedImage=null;if(uri==null){reply.done(null,null);return;}openRead(uri,getContentResolver().getType(uri),reply);return;}
                case "read.chunk":io.execute(()->{try{String token=p.getString("token");InputStream in=reads.get(token);if(in==null)throw new IOException("Image read expired");byte[] b=new byte[49152];int n=in.read(b);if(n<0){in.close();reads.remove(token);reply.done(new JSONObject().put("done",true),null);}else reply.done(new JSONObject().put("data",android.util.Base64.encodeToString(Arrays.copyOf(b,n),android.util.Base64.NO_WRAP)),null);}catch(Exception e){reply.done(null,"Could not read the image.");}});return;
                case "read.close":io.execute(()->{try{InputStream in=reads.remove(p.optString("token"));if(in!=null)in.close();reply.done(true,null);}catch(Exception e){reply.done(null,"Could not close image");}});return;
                case "qr.scan":if(scanReply!=null)throw new IllegalStateException("Scanner already open");scanReply=reply;new IntentIntegrator(this).setCaptureActivity(ScannerActivity.class).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE).setPrompt("Scan the QR from jaunt pair").setBeepEnabled(false).setOrientationLocked(false).initiateScan();return;
                case "save.begin":if(saveReply!=null)throw new IllegalStateException("A save dialog is already open");saveReply=reply;startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(p.optString("type","application/octet-stream")).putExtra(Intent.EXTRA_TITLE,p.optString("name","download")),41);return;
                case "save.chunk":io.execute(()->{try{String data=p.getString("data");if(data.length()>70000)throw new IOException("Chunk too large");OutputStream out=writes.get(p.getString("token"));if(out==null)throw new IOException("Save expired");out.write(android.util.Base64.decode(data,android.util.Base64.DEFAULT));reply.done(true,null);}catch(Exception e){reply.done(null,"Could not write the downloaded file.");}});return;
                case "save.close":io.execute(()->{try{OutputStream out=writes.remove(p.getString("token"));if(out!=null)out.close();reply.done(true,null);}catch(Exception e){reply.done(null,"Could not finish saving the file.");}});return;
                case "notifications.status":io.execute(()->{try{reply.done(new JSONObject().put("enabled",getSharedPreferences("native",0).getBoolean("notifications",false)).put("rooms",IdentityStore.get(this).read().names()),null);}catch(Exception e){reply.done(null,"Could not read notification preferences");}});return;
                case "notifications.enable":
                    if(notificationReply!=null)throw new IllegalStateException("Permission request already open");notificationMachine=p.getJSONObject("machine");notificationReply=reply;
                    if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},42);else enableNotifications();return;
                case "notifications.disable":io.execute(()->{try{IdentityStore.get(this).remove(p.getString("room"));startService(new Intent(this,NotificationService.class).setAction("refresh"));reply.done(true,null);}catch(Exception e){reply.done(null,"Could not disable background notifications.");}});return;
                case "notifications.clear":io.execute(()->{try{IdentityStore.get(this).clear();stopService(new Intent(this,NotificationService.class));reply.done(true,null);}catch(Exception e){reply.done(null,"Could not clear notification keys.");}});return;
                case "open.pending":{Intent intent=getIntent();JSONObject result=new JSONObject().put("host",intent.getStringExtra("host")).put("session",intent.getStringExtra("session"));intent.removeExtra("host");intent.removeExtra("session");reply.done(result,null);return;}
                default:throw new IllegalArgumentException("Unknown native action");
            }
        }catch(Exception e){reply.done(null,e.getMessage()==null?"Native action failed":e.getMessage());}
    }
    private void openRead(Uri uri,String type,Reply reply){
        io.execute(()->{try{if(!"content".equals(uri.getScheme()))throw new IOException();if(reads.size()>=4)throw new IOException();InputStream in=getContentResolver().openInputStream(uri);if(in==null)throw new IOException();String token=UUID.randomUUID().toString();reads.put(token,in);reply.done(new JSONObject().put("token",token).put("type",type==null?"image/png":type).put("name","android-image-"+System.currentTimeMillis()+".png"),null);}catch(Exception e){reply.done(null,"Android did not grant access to this image. Use Attach → image to select it from your gallery.");}});
    }
    private void enableNotifications(){
        Reply reply=notificationReply;JSONObject machine=notificationMachine;notificationReply=null;notificationMachine=null;
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){reply.done(null,"Notifications were not allowed. You can enable them in Android app settings.");return;}
        io.execute(()->{try{NotificationService.validate(machine);JSONObject saved=new JSONObject();for(String field:new String[]{"room","relay","relayToken","deviceId","secret","name"})saved.put(field,machine.getString(field));IdentityStore.get(this).put(saved);runOnUiThread(()->{startForegroundService(new Intent(this,NotificationService.class));reply.done(true,null);});}catch(Exception e){reply.done(null,"Could not save the notification connection.");}});
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){super.onRequestPermissionsResult(request,permissions,grants);if(request==42&&notificationReply!=null)enableNotifications();}
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        IntentResult scan=IntentIntegrator.parseActivityResult(request,result,data);
        if(scan!=null){if(scanReply!=null){scanReply.done(scan.getContents(),null);scanReply=null;}return;}
        if(request==44){updater.installPending();return;}
        if(request==40&&chooser!=null){chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));chooser=null;}
        if(request==41&&saveReply!=null){Reply reply=saveReply;saveReply=null;if(result!=RESULT_OK||data==null){reply.done(null,"Save cancelled");return;}Uri uri=data.getData();io.execute(()->{try{OutputStream out=getContentResolver().openOutputStream(uri,"wt");if(out==null)throw new IOException();String token=UUID.randomUUID().toString();writes.put(token,out);reply.done(new JSONObject().put("token",token),null);}catch(Exception e){reply.done(null,"Android could not create this file.");}});}
    }
    private void goBack(){if(web==null){moveTaskToBack(true);return;}web.evaluateJavascript("(()=>{const d=document.querySelector('dialog[open]');if(d){d.dispatchEvent(new Event('cancel'));d.close();return true;}return false;})()",value->{if(!"true".equals(value))moveTaskToBack(true);});}
    @Override public boolean onKeyUp(int key,KeyEvent event){if(Build.VERSION.SDK_INT<33&&key==KeyEvent.KEYCODE_BACK){goBack();return true;}return super.onKeyUp(key,event);}
    @Override protected void onDestroy(){mainHandler.removeCallbacksAndMessages(null);if(chooser!=null)chooser.onReceiveValue(null);io.execute(()->{for(InputStream in:reads.values())try{in.close();}catch(IOException ignored){}for(OutputStream out:writes.values())try{out.close();}catch(IOException ignored){}});io.shutdown();if(web!=null)web.destroy();super.onDestroy();}
}
