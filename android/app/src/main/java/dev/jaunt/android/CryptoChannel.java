package dev.jaunt.android;

import org.json.JSONObject;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.interfaces.ECPublicKey;
import java.security.spec.*;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.*;
import javax.crypto.spec.*;

/** Jaunt v1 P-256/HMAC/HKDF/AES-GCM, with strict per-direction replay counters. */
public final class CryptoChannel {
    private final byte[] sendKey, receiveKey, aad;
    private long sent, received;
    public static byte[] utf8(String s) { return s.getBytes(StandardCharsets.UTF_8); }
    public static String b64(byte[] b) { return Base64.getUrlEncoder().withoutPadding().encodeToString(b); }
    public static byte[] decode(String s) {
        if (s == null || !s.matches("[A-Za-z0-9_-]*={0,2}")) throw new IllegalArgumentException("Invalid encoded data");
        return Base64.getUrlDecoder().decode(s);
    }
    public static byte[] random(int n) { byte[] b=new byte[n]; new SecureRandom().nextBytes(b); return b; }
    public static byte[] hash(byte[] b) throws GeneralSecurityException { return MessageDigest.getInstance("SHA-256").digest(b); }
    private static byte[] concat(byte[]... parts) {
        int length=0; for(byte[] p:parts) length+=p.length;
        byte[] out=new byte[length]; int at=0;
        for(byte[] p:parts) { System.arraycopy(p,0,out,at,p.length); at+=p.length; } return out;
    }
    private static byte[] hmac(byte[] key, byte[] data) throws GeneralSecurityException {
        Mac mac=Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(key,"HmacSHA256")); return mac.doFinal(data);
    }
    public static String proof(byte[] secret,String label,byte[] transcript) throws GeneralSecurityException {
        return b64(hmac(secret,concat(utf8(label+":"),transcript)));
    }
    public static boolean verify(byte[] secret,String label,byte[] transcript,String signature) throws GeneralSecurityException {
        return MessageDigest.isEqual(decode(proof(secret,label,transcript)),decode(signature));
    }
    public static KeyPair ephemeral() throws GeneralSecurityException {
        KeyPairGenerator gen=KeyPairGenerator.getInstance("EC"); gen.initialize(new ECGenParameterSpec("secp256r1")); return gen.generateKeyPair();
    }
    private static byte[] coordinate(BigInteger n) {
        byte[] raw=n.toByteArray(),out=new byte[32]; int count=Math.min(32,raw.length);
        System.arraycopy(raw,raw.length-count,out,32-count,count); return out;
    }
    public static String publicKey(KeyPair pair) {
        ECPoint point=((ECPublicKey)pair.getPublic()).getW();
        return b64(concat(new byte[]{4},coordinate(point.getAffineX()),coordinate(point.getAffineY())));
    }
    public CryptoChannel(PrivateKey own,String remote,byte[] secret,byte[] transcript,boolean server) throws GeneralSecurityException {
        byte[] raw=decode(remote); if(raw.length!=65 || raw[0]!=4) throw new GeneralSecurityException("Invalid P-256 public key");
        AlgorithmParameters parameters=AlgorithmParameters.getInstance("EC"); parameters.init(new ECGenParameterSpec("secp256r1"));
        ECPoint point=new ECPoint(new BigInteger(1,Arrays.copyOfRange(raw,1,33)),new BigInteger(1,Arrays.copyOfRange(raw,33,65)));
        PublicKey peer=KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(point,parameters.getParameterSpec(ECParameterSpec.class)));
        KeyAgreement agreement=KeyAgreement.getInstance("ECDH"); agreement.init(own); agreement.doPhase(peer,true);
        aad=hash(transcript);
        byte[] prk=hmac(hash(secret),agreement.generateSecret());
        byte[] c2h=hmac(prk,concat(aad,utf8("jaunt-c2h"),new byte[]{1}));
        byte[] h2c=hmac(prk,concat(aad,utf8("jaunt-h2c"),new byte[]{1}));
        sendKey=server?h2c:c2h; receiveKey=server?c2h:h2c;
    }
    private byte[] crypt(int mode,byte[] key,long n,byte[] data) throws GeneralSecurityException {
        byte[] nonce=ByteBuffer.allocate(12).putInt(0).putLong(n).array();
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,nonce)); cipher.updateAAD(aad); return cipher.doFinal(data);
    }
    public synchronized JSONObject seal(JSONObject value) throws Exception {
        if(sent>=9007199254740991L) throw new GeneralSecurityException("Channel exhausted");
        long n=++sent;
        return new JSONObject().put("type","box").put("n",n).put("ct",b64(crypt(Cipher.ENCRYPT_MODE,sendKey,n,utf8(value.toString()))));
    }
    public synchronized JSONObject open(JSONObject frame) throws Exception {
        Object value=frame.get("n");
        if(!(value instanceof Number)) throw new GeneralSecurityException("Invalid replay counter");
        long n=((Number)value).longValue();
        if(!"box".equals(frame.getString("type")) || n!=received+1 || n>9007199254740991L || ((Number)value).doubleValue()!=(double)n)
            throw new GeneralSecurityException("Out-of-order or replayed frame");
        byte[] raw=crypt(Cipher.DECRYPT_MODE,receiveKey,n,decode(frame.getString("ct")));
        JSONObject result=new JSONObject(new String(raw,StandardCharsets.UTF_8)); received=n; return result;
    }
}
