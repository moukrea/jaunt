package dev.jaunt.android;
import org.json.*;
import org.junit.Test;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;
/** Runs the shared contract fixtures (tests/fixtures/update_channels.json, a Gradle test resource) against the Android implementation. */
public class UpdateChannelsTest {
    private static JSONObject contract()throws Exception{
        try(InputStream in=UpdateChannelsTest.class.getClassLoader().getResourceAsStream("update_channels.json")){
            assertNotNull("tests/fixtures/update_channels.json is not on the test classpath",in);
            return new JSONObject(new String(in.readAllBytes(),StandardCharsets.UTF_8));
        }
    }
    private static Iterable<Object> items(JSONArray array)throws JSONException{java.util.List<Object> out=new java.util.ArrayList<>();for(int i=0;i<array.length();i++)out.add(array.get(i));return out;}

    @Test public void names()throws Exception{
        JSONObject names=contract().getJSONObject("names");
        for(Object n:items(names.getJSONArray("valid")))assertTrue(n.toString(),UpdateChannels.validName((String)n));
        for(Object n:items(names.getJSONArray("invalid"))){assertFalse(n.toString(),UpdateChannels.validName((String)n));assertThrows(IllegalArgumentException.class,()->UpdateChannels.documentUrl((String)n));}
        for(Object n:items(names.getJSONArray("publishable"))){assertTrue(UpdateChannels.publishable((String)n));assertEquals(UpdateChannels.PAGE+"ch/"+n+"/config.json",UpdateChannels.documentUrl((String)n));}
        for(Object n:items(names.getJSONArray("notPublishable")))assertFalse(n.toString(),UpdateChannels.publishable((String)n));
        assertEquals(UpdateChannels.PAGE+"config.json",UpdateChannels.documentUrl("main"));
    }
    @Test public void tags()throws Exception{
        JSONObject tags=contract().getJSONObject("tags");
        for(Object o:items(tags.getJSONArray("valid"))){JSONObject c=(JSONObject)o;UpdateChannels.Tag t=UpdateChannels.parse(c.getString("tag"));
            assertEquals(c.getString("component"),t.component);assertEquals(c.getString("base"),t.base);assertEquals(c.getString("channel"),t.channel);assertEquals(c.getInt("n"),t.n);
            if(t.component.equals("android"))assertEquals(c.getString("tag"),"android-v"+c.getString("version"));}
        for(Object t:items(tags.getJSONArray("invalid")))assertThrows(t.toString(),IllegalArgumentException.class,()->UpdateChannels.parse(t));
        for(Object t:items(tags.getJSONArray("production"))){UpdateChannels.Tag p=UpdateChannels.parse(t);assertNull(p.channel);assertEquals(t,p.base);}
    }
    @Test public void order()throws Exception{
        JSONObject order=contract().getJSONObject("order");
        for(Object o:items(order.getJSONArray("ascending"))){JSONArray p=(JSONArray)o;
            assertEquals(p.toString(),-1,UpdateChannels.compare(p.getString(0),p.getString(1)));assertEquals(1,UpdateChannels.compare(p.getString(1),p.getString(0)));assertEquals(0,UpdateChannels.compare(p.getString(0),p.getString(0)));}
        for(Object o:items(order.getJSONArray("notComparable"))){JSONArray p=(JSONArray)o;assertThrows(p.toString(),UpdateChannels.NotComparable.class,()->UpdateChannels.compare(p.getString(0),p.getString(1)));}
    }
    @Test public void automaticUpdatesNeverCrossAChannel()throws Exception{
        for(Object o:items(contract().getJSONArray("automatic"))){JSONObject c=(JSONObject)o;
            // The fixture uses host tags; Android applies the same rule to its own component.
            for(String prefix:new String[]{"","android-"}){
                String current=prefix+c.getString("current"),target=prefix+c.getString("target");
                assertEquals(c.toString(),c.getBoolean("install"),UpdateChannels.automatic(c.getString("channel"),current,target));}}
    }
    @Test public void androidCodes()throws Exception{
        JSONObject android=contract().getJSONObject("android");
        for(Object o:items(android.getJSONArray("nextProductionCode"))){JSONArray p=(JSONArray)o;assertEquals(p.getLong(1),UpdateChannels.nextProductionCode(p.getLong(0)));}
        for(Object o:items(android.getJSONArray("candidateCode"))){JSONObject c=(JSONObject)o;long code=UpdateChannels.candidateCode(c.getLong("base"),c.getInt("k"));
            assertEquals(c.getLong("code"),code);assertTrue(code<UpdateChannels.nextProductionCode(c.getLong("base")));}
        for(Object o:items(android.getJSONArray("invalidCandidateCode"))){JSONObject c=(JSONObject)o;assertThrows(IllegalArgumentException.class,()->UpdateChannels.candidateCode(c.getLong("base"),c.getInt("k")));}
        for(Object o:items(android.getJSONArray("switch"))){JSONObject c=(JSONObject)o;assertEquals(c.toString(),c.getBoolean("allowed"),UpdateChannels.switchAllowed(c.getLong("current"),c.getLong("target")));}
    }
    @Test public void documents()throws Exception{
        JSONObject documents=contract().getJSONObject("documents"),official=documents.getJSONObject("official");
        assertEquals(official.getString("page"),UpdateChannels.PAGE);assertEquals(official.getString("repository"),UpdateChannels.REPOSITORY);
        JSONObject valid=documents.getJSONArray("valid").getJSONObject(0);
        for(Object o:items(documents.getJSONArray("valid"))){JSONObject c=(JSONObject)o;UpdateChannels.validateDocument(new JSONObject(c.getJSONObject("document").toString()),c.getString("name"));}
        for(Object o:items(documents.getJSONArray("invalid"))){JSONObject c=(JSONObject)o,patch=c.getJSONObject("patch");
            // A null patch value is tried both as JSON null and as a missing field.
            for(boolean remove:new boolean[]{false,true}){
                JSONObject document=new JSONObject(valid.getJSONObject("document").toString());
                for(java.util.Iterator<String> it=patch.keys();it.hasNext();){String k=it.next();if(remove&&patch.isNull(k))document.remove(k);else document.put(k,patch.get(k));}
                assertThrows(c.getString("why"),IllegalArgumentException.class,()->UpdateChannels.validateDocument(document,c.getString("name")));}}
    }
}
