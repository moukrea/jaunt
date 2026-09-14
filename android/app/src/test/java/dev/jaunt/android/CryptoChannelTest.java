package dev.jaunt.android;
import org.json.JSONObject;
import org.junit.Test;
import java.security.KeyPair;
import static org.junit.Assert.*;

public class CryptoChannelTest {
    @Test public void bidirectionalReplayAndTamper() throws Exception {
        KeyPair a=CryptoChannel.ephemeral(), b=CryptoChannel.ephemeral();
        byte[] secret=CryptoChannel.random(32),tx=CryptoChannel.utf8("jaunt-test-transcript");
        CryptoChannel client=new CryptoChannel(a.getPrivate(),CryptoChannel.publicKey(b),secret,tx,false);
        CryptoChannel server=new CryptoChannel(b.getPrivate(),CryptoChannel.publicKey(a),secret,tx,true);
        JSONObject frame=client.seal(new JSONObject().put("message","été 日本語"));
        assertEquals("été 日本語",server.open(frame).getString("message"));
        assertThrows(Exception.class,()->server.open(frame));
        JSONObject response=server.seal(new JSONObject().put("ok",true));
        assertTrue(client.open(response).getBoolean("ok"));
        JSONObject original=client.seal(new JSONObject().put("still","working"));
        JSONObject damaged=new JSONObject(original.toString()); byte[] ciphertext=CryptoChannel.decode(damaged.getString("ct"));ciphertext[0]^=1;damaged.put("ct",CryptoChannel.b64(ciphertext));
        assertThrows(Exception.class,()->server.open(damaged));
        assertEquals("working",server.open(original).getString("still"));
    }
    @Test public void proofBindsRoleAndTranscript() throws Exception {
        byte[] secret=CryptoChannel.random(32),tx=CryptoChannel.utf8("test");
        String signature=CryptoChannel.proof(secret,"server",tx);
        assertTrue(CryptoChannel.verify(secret,"server",tx,signature));
        assertFalse(CryptoChannel.verify(secret,"client",tx,signature));
        assertFalse(CryptoChannel.verify(secret,"server",CryptoChannel.utf8("other"),signature));
    }
}
