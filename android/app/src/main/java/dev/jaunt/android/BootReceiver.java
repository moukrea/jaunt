package dev.jaunt.android;
import android.content.*;
public final class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
        if(Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())&&context.getSharedPreferences("native",0).getBoolean("notifications",false))
            context.startForegroundService(new Intent(context,NotificationService.class));
    }
}
