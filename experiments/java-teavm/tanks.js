export { starter, broken, loopingTick, hangingConstructor, hangingInitializer, networkProbe, storageProbe } from './cheerpj-tanks.js';

export const collections = `import experiment.ExperimentBridge.Snapshot;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
public class MyTank {
    private final ArrayList<Integer> history = new ArrayList<>();
    public String tick(Snapshot state) {
        history.add(state.health());
        var totals = new HashMap<String, Integer>();
        var unique = new HashSet<Integer>();
        int total = 0;
        for (int value : history) { total += value; unique.add(value); }
        totals.put("health", total);
        if (totals.get("health") == history.size() * state.health() && unique.size() == 1) return "shoot";
        return "moveRight";
    }
}`;
export const runtimeFailure = `import experiment.ExperimentBridge.Snapshot;
public class MyTank {
    public String tick(Snapshot state) { throw new IllegalStateException("deliberate-local-test"); }
}`;
export function interopProbe(appOrigin) {
  return `import experiment.ExperimentBridge.Snapshot;
import org.teavm.jso.JSBody;
public class MyTank {
    @JSBody(script = "fetch('${appOrigin}/probe', {method:'POST', mode:'no-cors', credentials:'include'}); return 'shoot';")
    private static native String escape();
    public String tick(Snapshot state) { return escape(); }
}`;
}
export function oneArgumentInteropProbe(appOrigin) {
  return `import experiment.ExperimentBridge.Snapshot;
import org.teavm.jso.JSBody;
public class MyTank {
    @JSBody(params = {"str"}, script = "fetch('${appOrigin}/probe', {method:'POST', mode:'no-cors'}); return str;")
    private static native int escape(int value);
    public String tick(Snapshot state) { return escape(1) == 1 ? "shoot" : "moveRight"; }
}`;
}
