package dev.jaunt.android;
import org.junit.Test;
import static org.junit.Assert.*;
public class UpdateVersionTest {
    @Test public void releaseOrderingRejectsDowngradesAndSeparatesPrereleases(){
        assertTrue(UpdateChannels.automatic("main",UpdateManager.installedTag("0.1.0-beta.1"),"android-v0.1.0-beta.2"));
        assertTrue(UpdateChannels.automatic("main",UpdateManager.installedTag("0.1.0-rc.3"),"android-v0.1.0"));
        assertFalse(UpdateChannels.automatic("main",UpdateManager.installedTag("0.1.0"),"android-v0.1.0-beta.4"));
        assertFalse(UpdateChannels.automatic("main",UpdateManager.installedTag("0.1.0-beta.1"),"android-v0.1.0-beta.1"));
        assertThrows(IllegalArgumentException.class,()->UpdateManager.installedTag("../../bad"));
        assertThrows(IllegalArgumentException.class,()->UpdateChannels.automatic("main","android-v0.1.0","../../bad"));
    }
    @Test public void installedCandidatesFollowOnlyTheirChannel(){
        String candidate=UpdateManager.installedTag("0.1.0-beta.31.ch.moukrea.9.2");
        assertTrue(UpdateChannels.automatic("moukrea_9",candidate,"android-v0.1.0-beta.31.ch.moukrea.9.3"));
        assertFalse(UpdateChannels.automatic("main",candidate,"android-v0.1.0-beta.31"));
        assertTrue(UpdateChannels.automatic("main",candidate,"android-v0.1.0-beta.32"));
        assertFalse(UpdateChannels.automatic("moukrea_9",candidate,"desktop-v0.1.0-beta.31.ch.moukrea.9.3"));
        assertThrows(IllegalArgumentException.class,()->UpdateManager.installedTag("0.1.0-beta.31-debug"));
    }
}
