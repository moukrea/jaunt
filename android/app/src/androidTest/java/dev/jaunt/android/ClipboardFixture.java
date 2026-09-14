package dev.jaunt.android;

import android.app.Instrumentation;
import android.app.Activity;
import android.content.*;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import java.io.*;

/** Emulator-only fixture. Not packaged in the release APK. */
public final class ClipboardFixture extends Instrumentation {
    @Override public void onCreate(Bundle arguments){super.onCreate(arguments);start();}
    @Override public void onStart(){Bundle result=new Bundle();try{
        Context context=getTargetContext();
        Intent intent=new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivitySync(intent);waitForIdleSync();
        ContentValues values=new ContentValues();values.put(MediaStore.Images.Media.DISPLAY_NAME,"jaunt-clipboard-fixture.png");values.put(MediaStore.Images.Media.MIME_TYPE,"image/png");
        Uri uri=context.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values);
        if(uri==null)throw new IOException("No image URI");
        try(InputStream in=context.getAssets().open("jaunt/assets/favicon.png");OutputStream out=context.getContentResolver().openOutputStream(uri)){byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);}
        runOnMainSync(()->((ClipboardManager)context.getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newUri(context.getContentResolver(),"Jaunt test PNG",uri)));
        result.putString("result","Synthetic PNG placed in Android image clipboard");finish(Activity.RESULT_OK,result);
    }catch(Exception e){result.putString("error",e.getClass().getSimpleName());finish(Activity.RESULT_CANCELED,result);}}
}
