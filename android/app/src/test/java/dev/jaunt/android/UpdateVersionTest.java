package dev.jaunt.android;
import org.junit.Test;
import static org.junit.Assert.*;
public class UpdateVersionTest {
    @Test public void releaseOrderingRejectsDowngradesAndSeparatesPrereleases(){
        assertTrue(UpdateManager.newer("android-v0.1.0-beta.2","0.1.0-beta.1"));
        assertTrue(UpdateManager.newer("android-v0.1.0","0.1.0-rc.3"));
        assertFalse(UpdateManager.newer("android-v0.1.0-beta.4","0.1.0"));
        assertFalse(UpdateManager.newer("android-v0.1.0-beta.1","0.1.0-beta.1"));
        assertThrows(IllegalArgumentException.class,()->UpdateManager.newer("../../bad","0.1.0"));
    }
}
