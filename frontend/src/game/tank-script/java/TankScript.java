package tankscript;

import java.util.List;
import org.teavm.jso.JSBody;

/** Read-only tick state and the seven TankScript actions. */
public final class TankScript {
    public record Position(double x, double y) {}
    public record Tank(double id, String name, double x, double y, double rotation, double health) {}
    public record Bullet(double id, double ownerId, double x, double y, double rotation) {}
    public record Snapshot(double tankId, Position tankPosition, double tankRotation, double tankHealth,
                           List<Tank> allTanks, List<Bullet> allBullets, double arenaWidth, double arenaHeight) {
        public Snapshot {
            allTanks = List.copyOf(allTanks);
            allBullets = List.copyOf(allBullets);
        }
    }

    // The loader maps this exact helper to a host-owned collector; it never evaluates its text.
    @JSBody(params = {"action"}, script = "submitTankScriptAction(action);")
    private static native void submit(int action);

    public void moveUp() { submit(1); }
    public void moveDown() { submit(2); }
    public void moveLeft() { submit(3); }
    public void moveRight() { submit(4); }
    public void rotateLeft() { submit(5); }
    public void rotateRight() { submit(6); }
    public void shoot() { submit(7); }
}
