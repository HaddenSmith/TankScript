export default `import tankscript.TankScript;
import tankscript.TankScript.Snapshot;

public class MyTank {
    private int ticks;

    public void tick(Snapshot state, TankScript api) {
        ticks++;
        for (var enemy : state.allTanks()) {
            if (enemy.id() != state.tankId() && enemy.health() > 0) {
                api.shoot();
                return;
            }
        }
        api.moveRight();
    }
}
`;
