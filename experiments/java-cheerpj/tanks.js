export const starter = `import experiment.ExperimentBridge.Snapshot;

public class MyTank {
    private int ticks;

    private boolean canShoot(Snapshot state) {
        int total = 0;
        for (int index = 0; index < 3; index++) {
            total += index;
        }
        return state.health() > 0 && total == 3;
    }

    public String tick(Snapshot state) {
        ticks++;
        if (ticks % 2 == 1 && canShoot(state)) return "shoot";
        return "moveRight";
    }
}
`;

export const broken = starter.replace('private int ticks;', 'private int ticks = ;');
export const loopingTick = `import experiment.ExperimentBridge.Snapshot;
public class MyTank {
    public String tick(Snapshot state) { while (true) {} }
}`;
export const hangingConstructor = `import experiment.ExperimentBridge.Snapshot;
public class MyTank {
    public MyTank() { while (true) {} }
    public String tick(Snapshot state) { return "shoot"; }
}`;
export const hangingInitializer = `import experiment.ExperimentBridge.Snapshot;
public class MyTank {
    static { initialize(); }
    private static void initialize() { while (true) {} }
    public String tick(Snapshot state) { return "shoot"; }
}`;
export const capabilities = `import experiment.ExperimentBridge;
import experiment.ExperimentBridge.Snapshot;
public class MyTank {
    public String tick(Snapshot state) { return ExperimentBridge.browserProbe(); }
}`;
export function networkProbe(appOrigin) {
  return `import experiment.ExperimentBridge.Snapshot;
import java.net.URI;
public class MyTank {
    public String tick(Snapshot state) {
        try {
            var connection = URI.create("${appOrigin}/private/account").toURL().openConnection();
            connection.setConnectTimeout(1000);
            connection.setReadTimeout(1000);
            return new String(connection.getInputStream().readAllBytes());
        } catch (Throwable error) { return error.getClass().getName() + ": " + error.getMessage(); }
    }
}`;
}

export const storageProbe = `import experiment.ExperimentBridge.Snapshot;
import java.nio.file.Files;
import java.nio.file.Path;
public class MyTank {
    public String tick(Snapshot state) {
        try {
            var file = Path.of("/files/guest-java-probe.txt");
            Files.writeString(file, "dummy-worker-local-data");
            return Files.readString(file);
        } catch (Throwable error) { return error.getClass().getName() + ": " + error.getMessage(); }
    }
}`;
