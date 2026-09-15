package dev.jaunt.android;

import android.app.*;
import android.content.*;
import android.os.*;
import org.json.*;
import okhttp3.*;
import java.security.KeyPair;
import java.util.*;
import java.util.concurrent.*;

/** Opt-in native connection: receives encrypted notifications without a running WebView. */
public class NotificationService extends Service {
    static volatile boolean uiVisible;
    private static final String CONNECTION="jaunt-connection",EVENTS="jaunt-events";
    private final ScheduledExecutorService serial=Executors.newSingleThreadScheduledExecutor();
    private final Map<String,Connection> connections=new HashMap<>();
    private final OkHttpClient client=new OkHttpClient.Builder().pingInterval(20,TimeUnit.SECONDS).build();
    private volatile boolean stopped;
    static void validate(JSONObject m)throws Exception{
        String relay=m.getString("relay");java.net.URI uri=new java.net.URI(relay);
        if(!"wss".equals(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null)throw new IllegalArgumentException("Encrypted relay required");
        if(!m.getString("room").matches("[A-Za-z0-9_-]{24}")||!m.getString("deviceId").matches("[A-Za-z0-9_-]{8,80}"))throw new IllegalArgumentException("Invalid identity");
        if(CryptoChannel.decode(m.getString("secret")).length!=32||CryptoChannel.decode(m.getString("relayToken")).length!=32||m.optBoolean("pending"))throw new IllegalArgumentException("Pair first");
    }
    @Override public void onCreate(){super.onCreate();NotificationManager manager=getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CONNECTION,"Background connection",NotificationManager.IMPORTANCE_LOW));
        manager.createNotificationChannel(new NotificationChannel(EVENTS,"Shell notifications",NotificationManager.IMPORTANCE_DEFAULT));
        serial.scheduleWithFixedDelay(()->{for(Connection c:new ArrayList<>(connections.values()))c.tick();new UpdateManager(NotificationService.this).check(false);},20,20,TimeUnit.SECONDS);
    }
    private PendingIntent open(String room,String session){Intent intent=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("host",room).putExtra("session",session);return PendingIntent.getActivity(this,Objects.hash(room,session),intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    private Notification ongoing(String text){PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,NotificationService.class).setAction("stop"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this,CONNECTION).setSmallIcon(dev.jaunt.android.R.drawable.ic_jaunt).setContentTitle("jaunt · background connection").setContentText(text).setContentIntent(open("","")).setOngoing(true).setVisibility(Notification.VISIBILITY_PRIVATE).addAction(new Notification.Action.Builder(null,"Stop",stop).build()).build();}
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if(intent!=null&&"stop".equals(intent.getAction())){getSharedPreferences("native",0).edit().putBoolean("notifications",false).apply();stopSelf();return START_NOT_STICKY;}
        startForeground(1,ongoing("Connecting to your hosts…"));getSharedPreferences("native",0).edit().putBoolean("notifications",true).apply();
        serial.execute(()->{try{JSONObject all=IdentityStore.get(this).read();Set<String> wanted=new HashSet<>();for(Iterator<String> it=all.keys();it.hasNext();){String room=it.next();wanted.add(room);if(connections.containsKey(room)&&connections.get(room).closed)connections.remove(room);if(!connections.containsKey(room)){JSONObject m=all.getJSONObject(room);validate(m);Connection c=new Connection(m);connections.put(room,c);c.connect();}}
            for(String room:new HashSet<>(connections.keySet()))if(!wanted.contains(room))connections.remove(room).close();
            if(connections.isEmpty())stopSelf();else status();
        }catch(Exception e){getSystemService(NotificationManager.class).notify(1,ongoing("Open jaunt to restore your connection."));}});
        return START_STICKY;
    }
    private void status(){long online=connections.values().stream().filter(c->c.online).count();getSystemService(NotificationManager.class).notify(1,ongoing(online+" / "+connections.size()+" hosts connected · reconnects automatically"));}
    private void notifyEvent(JSONObject machine,JSONObject value){
        // Never expose terminal output or arbitrary notification bodies on a locked screen.
        String room=machine.optString("room"),session=value.optString("session");
        Notification n=new Notification.Builder(this,EVENTS).setSmallIcon(dev.jaunt.android.R.drawable.ic_jaunt).setContentTitle("jaunt").setContentText(machine.optString("name","Your host")+" needs your attention.").setContentIntent(open(room,session)).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build();
        getSystemService(NotificationManager.class).notify(100+Math.floorMod(Objects.hash(room,session),100000),n);
    }
    private class Connection {
        final JSONObject machine;WebSocket ws;KeyPair pair;JSONObject hello;CryptoChannel channel;long generation,lastHost,opened;boolean online,closed;int delay=1;
        Connection(JSONObject machine){this.machine=machine;}
        void connect(){if(stopped||closed)return;long current=++generation;channel=null;online=false;opened=System.currentTimeMillis();
            Request request=new Request.Builder().url(machine.optString("relay")+"/v1/room/"+machine.optString("room")).header("Origin",MainActivity.ORIGIN).build();
            ws=client.newWebSocket(request,new WebSocketListener(){
                private void dispatch(Runnable action){if(!stopped)try{serial.execute(()->{if(current==generation&&!closed)action.run();});}catch(RejectedExecutionException ignored){}}
                @Override public void onOpen(WebSocket socket,Response response){dispatch(()->{try{socket.send(new JSONObject().put("type","auth").put("role","client").put("token",machine.getString("relayToken")).toString());}catch(Exception e){fail();}});}
                @Override public void onMessage(WebSocket socket,String text){dispatch(()->{try{receive(text);}catch(Exception e){close();getSystemService(NotificationManager.class).notify(1,ongoing("Secure connection could not be verified. Open jaunt."));}});}
                @Override public void onClosed(WebSocket socket,int code,String reason){dispatch(()->fail());}
                @Override public void onFailure(WebSocket socket,Throwable error,Response response){dispatch(()->fail());}
            });
        }
        void plain(JSONObject frame)throws Exception{if(ws==null||!ws.send(new JSONObject().put("type","route").put("data",frame).toString()))throw new java.io.IOException("Offline");}
        void handshake()throws Exception{online=false;channel=null;pair=CryptoChannel.ephemeral();hello=new JSONObject().put("type","hello").put("v",1).put("auth","device").put("id",machine.getString("deviceId")).put("pair","").put("nonce",CryptoChannel.b64(CryptoChannel.random(32))).put("pub",CryptoChannel.publicKey(pair));opened=System.currentTimeMillis();plain(hello);status();}
        void receive(String text)throws Exception{
            if(text.equals("pong"))return;if(text.length()>160000)throw new SecurityException("Oversized frame");JSONObject envelope=new JSONObject(text);String type=envelope.getString("type");
            if(type.equals("ready")){if(envelope.optBoolean("hostOnline"))handshake();return;}
            if(type.equals("host.online")){handshake();return;}
            if(type.equals("host.offline")){online=false;channel=null;opened=0;status();return;}
            if(!type.equals("route"))return;JSONObject m=envelope.getJSONObject("data");type=m.getString("type");
            if(type.equals("error")){if(m.optString("code").equals("unknown-device")){IdentityStore.get(NotificationService.this).remove(machine.getString("room"));close();status();return;}throw new SecurityException("Host rejected authentication");}
            if(type.equals("challenge")&&pair!=null&&channel==null){byte[] secret=CryptoChannel.decode(machine.getString("secret"));byte[] transcript=CryptoChannel.utf8(new JSONArray().put("jaunt-v1").put(machine.getString("room")).put("device").put(machine.getString("deviceId")).put("").put(hello.getString("nonce")).put(hello.getString("pub")).put(m.getString("nonce")).put(m.getString("pub")).toString());
                if(!CryptoChannel.verify(secret,"server",transcript,m.getString("mac")))throw new SecurityException("Invalid host proof");channel=new CryptoChannel(pair.getPrivate(),m.getString("pub"),secret,transcript,false);pair=null;plain(new JSONObject().put("type","proof").put("mac",CryptoChannel.proof(secret,"client",transcript)));return;}
            if(channel==null)throw new SecurityException("Unencrypted message");JSONObject value=channel.open(m);lastHost=System.currentTimeMillis();
            switch(value.getString("type")){
                case "welcome":online=true;delay=1;status();break;
                case "notification":notifyEvent(machine,value);break;
                case "revoked":IdentityStore.get(NotificationService.this).remove(machine.getString("room"));close();status();break;
                default:break;
            }
        }
        void tick(){if(closed)return;try{if(online&&System.currentTimeMillis()-lastHost>55000){fail();return;}if(!online&&opened>0&&System.currentTimeMillis()-opened>30000){fail();return;}if(ws!=null){ws.send("ping");if(online)plain(channel.seal(new JSONObject().put("type","ping").put("at",System.currentTimeMillis())));}}catch(Exception e){fail();}}
        void fail(){if(closed||stopped)return;++generation;if(ws!=null)ws.cancel();ws=null;channel=null;online=false;opened=0;status();int wait=delay;delay=Math.min(30,delay*2);serial.schedule(this::connect,wait,TimeUnit.SECONDS);}
        void close(){closed=true;++generation;online=false;if(ws!=null)ws.cancel();channel=null;pair=null;}
    }
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onDestroy(){stopped=true;serial.execute(()->{for(Connection c:connections.values())c.close();connections.clear();client.dispatcher().executorService().shutdown();client.connectionPool().evictAll();});serial.shutdown();super.onDestroy();}
}
