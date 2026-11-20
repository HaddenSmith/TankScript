import java.util.ArrayList;
import org.teavm.jso.JSExport;
import tankscript.TankScript;

/** Trusted primitive/string boundary between the worker and a player's MyTank. */
public final class TankEntrypoint {
    private static MyTank tank;
    private static final TankScript api = new TankScript();
    private static final ArrayList<TankScript.Tank> tanks = new ArrayList<>();
    private static final ArrayList<TankScript.Bullet> bullets = new ArrayList<>();
    private static double id, x, y, rotation, health, width, height;

    @JSExport public static void construct() { tank = new MyTank(); }

    @JSExport public static void beginSnapshot(double tankId, double tankX, double tankY,
                                              double tankRotation, double tankHealth,
                                              double arenaWidth, double arenaHeight) {
        id = tankId; x = tankX; y = tankY; rotation = tankRotation; health = tankHealth;
        width = arenaWidth; height = arenaHeight;
        tanks.clear(); bullets.clear();
    }

    @JSExport public static void addTank(double id, String name, double x, double y, double rotation, double health) {
        tanks.add(new TankScript.Tank(id, name, x, y, rotation, health));
    }

    @JSExport public static void addBullet(double id, double ownerId, double x, double y, double rotation) {
        bullets.add(new TankScript.Bullet(id, ownerId, x, y, rotation));
    }

    @JSExport public static void tick() {
        var snapshot = new TankScript.Snapshot(id, new TankScript.Position(x, y), rotation, health,
                tanks, bullets, width, height);
        tank.tick(snapshot, api);
    }
}
