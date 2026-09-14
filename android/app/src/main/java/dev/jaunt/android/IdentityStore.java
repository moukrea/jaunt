package dev.jaunt.android;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import org.json.JSONObject;
import java.io.*;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

/** Notification identities are encrypted by a non-exportable Android Keystore key. */
final class IdentityStore {
    private final Context context;
    private static final String ALIAS="jaunt-notification-identities-v1";
    private static IdentityStore instance;
    static synchronized IdentityStore get(Context context){if(instance==null)instance=new IdentityStore(context);return instance;}
    private IdentityStore(Context context) { this.context=context.getApplicationContext(); }
    private SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if(!store.containsAlias(ALIAS)) {
            KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            gen.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());gen.generateKey();
        }
        return ((KeyStore.SecretKeyEntry)store.getEntry(ALIAS,null)).getSecretKey();
    }
    synchronized JSONObject read() throws Exception {
        File file=new File(context.getNoBackupFilesDir(),"notification-identities.enc");
        if(!file.exists()) return new JSONObject();
        byte[] raw;try(InputStream in=new FileInputStream(file)){ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] chunk=new byte[4096];int n;while((n=in.read(chunk))!=-1){if(out.size()+n>100000)throw new IOException("Identity storage too large");out.write(chunk,0,n);}raw=out.toByteArray();}
        if(raw.length<29 || raw.length>100000) throw new IOException("Invalid identity storage");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Arrays.copyOf(raw,12)));
        return new JSONObject(new String(cipher.doFinal(Arrays.copyOfRange(raw,12,raw.length)),java.nio.charset.StandardCharsets.UTF_8));
    }
    synchronized void write(JSONObject value) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        File dir=context.getNoBackupFilesDir(),tmp=new File(dir,"notification-identities.tmp"),file=new File(dir,"notification-identities.enc");
        try(FileOutputStream out=new FileOutputStream(tmp)){out.write(cipher.getIV());out.write(cipher.doFinal(CryptoChannel.utf8(value.toString())));out.getFD().sync();}
        if(!tmp.renameTo(file)) throw new IOException("Could not persist notification identities");
    }
    synchronized void put(JSONObject machine) throws Exception { JSONObject data=read();data.put(machine.getString("room"),machine);write(data); }
    synchronized void remove(String room) throws Exception { JSONObject data=read();data.remove(room);write(data); }
    synchronized void clear() throws Exception { write(new JSONObject()); }
}
