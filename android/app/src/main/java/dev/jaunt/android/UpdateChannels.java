package dev.jaunt.android;

import org.json.JSONObject;
import java.util.*;
import java.util.regex.*;

/** Update-channel contract (docs/UPDATES.md#update-channels), tested against tests/fixtures/update_channels.json like scripts/update_channels.py. */
final class UpdateChannels {
    static final String PAGE="https://moukrea.github.io/jaunt/",REPOSITORY="moukrea/jaunt";
    static final int CODE_STEP=1000;
    private static final Map<String,String> PREFIX=new LinkedHashMap<>();
    static{PREFIX.put("host","v");PREFIX.put("desktop","desktop-v");PREFIX.put("android","android-v");}
    private static final Map<String,String> DOCUMENT=new LinkedHashMap<>();
    static{DOCUMENT.put("host","release");DOCUMENT.put("desktop","desktopRelease");DOCUMENT.put("android","androidRelease");}
    private static final Set<String> RESERVED=Set.of("main","beta");
    private static final List<String> STAGES=List.of("alpha","beta","rc");
    private static final String DEV="[a-z][a-z0-9]{0,31}",COUNT="[1-9][0-9]{0,5}";
    private static final Pattern NAME=Pattern.compile(DEV+"(?:_"+COUNT+")?"),SOURCE=Pattern.compile("[0-9a-f]{40}");
    private static final Pattern PRODUCTION=Pattern.compile("(\\d+)\\.(\\d+)\\.(\\d+)(?:-(alpha|beta|rc)\\.(\\d+))?");
    // Candidates only extend a prerelease base: a final X.Y.Z has no semver-safe suffix below X.Y.(Z+1).
    private static final Pattern CANDIDATE=Pattern.compile("(\\d+)\\.(\\d+)\\.(\\d+)-(alpha|beta|rc)\\.(\\d+)\\.ch\\.("+DEV+")\\.("+COUNT+")\\.("+COUNT+")");
    private UpdateChannels(){}

    /** Two versions from different channels or components: no automatic order exists. */
    static final class NotComparable extends IllegalArgumentException{NotComparable(String message){super(message);}}

    static final class Tag{
        final String component,base,channel;final long[] key;final int n;
        Tag(String component,long[] key,String base,String channel,int n){this.component=component;this.key=key;this.base=base;this.channel=channel;this.n=n;}
    }

    static boolean validName(String name){return name!=null&&NAME.matcher(name).matches();}
    /** Only a per-PR sub-channel of a non-reserved developer may be published. */
    static boolean publishable(String name){return validName(name)&&name.contains("_")&&!RESERVED.contains(name.split("_")[0]);}
    /** A name is never a URL: it resolves against the official Page only. */
    static String documentUrl(String name){
        if("main".equals(name))return PAGE+"config.json";
        if(!publishable(name))throw new IllegalArgumentException("Unknown update channel name");
        return PAGE+"ch/"+name+"/config.json";
    }

    static Tag parse(Object value){
        if(value instanceof String){String tag=(String)value;
            for(Map.Entry<String,String> prefix:PREFIX.entrySet()){
                if(!tag.startsWith(prefix.getValue()))continue;
                String rest=tag.substring(prefix.getValue().length());
                Matcher m=PRODUCTION.matcher(rest);
                if(m.matches())return new Tag(prefix.getKey(),key(m),tag,null,0);
                m=CANDIDATE.matcher(rest);
                if(m.matches()&&!RESERVED.contains(m.group(6)))
                    return new Tag(prefix.getKey(),key(m),prefix.getValue()+m.group(1)+"."+m.group(2)+"."+m.group(3)+"-"+m.group(4)+"."+m.group(5),m.group(6)+"_"+m.group(7),Integer.parseInt(m.group(8)));
                break;
            }
        }
        throw new IllegalArgumentException("Unsupported release tag");
    }
    private static long[] key(Matcher m){
        return new long[]{Long.parseLong(m.group(1)),Long.parseLong(m.group(2)),Long.parseLong(m.group(3)),m.group(4)==null?3:STAGES.indexOf(m.group(4)),m.group(5)==null?0:Long.parseLong(m.group(5))};
    }

    /** -1, 0 or 1; throws NotComparable across components or between two channels. */
    static int compare(String a,String b){
        Tag x=parse(a),y=parse(b);
        if(!x.component.equals(y.component)||x.channel!=null&&y.channel!=null&&!x.channel.equals(y.channel))throw new NotComparable(a+" and "+b+" are not ordered");
        for(int i=0;i<x.key.length;i++)if(x.key[i]!=y.key[i])return Long.compare(x.key[i],y.key[i]);
        int c=Integer.compare(x.channel==null?0:1,y.channel==null?0:1);
        return c!=0?c:Integer.compare(x.n,y.n);
    }

    /** Whether an unattended check on `channel` may install `target` over `current`; only an explicit channel change may install anything else. */
    static boolean automatic(String channel,String current,String target){
        Tag x=parse(current),y=parse(target);
        if(!x.component.equals(y.component))return false;
        if("main".equals(channel))return y.channel==null&&compare(current,target)<0;
        return channel.equals(x.channel)&&channel.equals(y.channel)&&compare(current,target)<0;
    }

    /** Android production codes are spaced so that every candidate of a base sorts below the next release. */
    static long nextProductionCode(long previous){return previous>=CODE_STEP?(previous/CODE_STEP+1)*CODE_STEP:(previous+1)*CODE_STEP;}
    static long candidateCode(long base,int k){
        if(base>=CODE_STEP&&base%CODE_STEP!=0||k<=0||k>=CODE_STEP)throw new IllegalArgumentException("Invalid Android candidate code");
        return (base>=CODE_STEP?base:base*CODE_STEP)+k;
    }
    /** Android refuses a lower or equal versionCode; a switch needing one requires uninstalling. */
    static boolean switchAllowed(long current,long target){return target>current;}

    /** Checks a fetched ch/<name>/config.json against the requested name and the official installation. */
    static JSONObject validateDocument(JSONObject document,String name){
        if(!publishable(name))throw new IllegalArgumentException("Reserved or invalid channel name has no channel document");
        Object version=document.opt("version");
        if(!(version instanceof Integer)||(Integer)version!=1||!name.equals(document.opt("channel")))throw new IllegalArgumentException("Channel document does not describe the requested channel");
        if(!PAGE.equals(document.opt("page"))||!REPOSITORY.equals(document.opt("repository")))throw new IllegalArgumentException("Channel document is not from the official Page and repository");
        Object source=document.opt("releaseSource");
        if(!(source instanceof String)||!SOURCE.matcher((String)source).matches())throw new IllegalArgumentException("Channel document has no verified release source");
        Set<Integer> counts=new HashSet<>();
        for(Map.Entry<String,String> field:DOCUMENT.entrySet()){
            Tag tag=parse(document.opt(field.getValue()));
            if(!tag.component.equals(field.getKey())||!name.equals(tag.channel))throw new IllegalArgumentException(field.getValue()+" is not a "+field.getKey()+" candidate of "+name);
            counts.add(tag.n);
        }
        if(counts.size()!=1)throw new IllegalArgumentException("Channel components come from different candidates");
        return document;
    }
}
