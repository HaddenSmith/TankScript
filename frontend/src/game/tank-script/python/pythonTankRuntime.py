import builtins as _builtins
import collections as _collections
import json as _json
import sys as _sys
import time as _time
import traceback as _traceback

_ACTIONS = (
    ("move_up", "moveUp"), ("move_down", "moveDown"),
    ("move_left", "moveLeft"), ("move_right", "moveRight"),
    ("rotate_left", "rotateLeft"), ("rotate_right", "rotateRight"),
    ("shoot", "shoot"),
)
_ALLOWED_IMPORTS = {"math", "random", "statistics", "collections", "itertools", "functools", "operator"}

# Warm supported modules before timed ticks so a first import cannot consume the turn budget.
for _module_name in _ALLOWED_IMPORTS:
    _builtins.__import__(_module_name)


class _TankTimeout(BaseException):
    pass


def _error(code, error):
    if isinstance(error, SyntaxError):
        line, column = error.lineno, error.offset
        message = error.msg
    else:
        frames = [frame for frame in _traceback.extract_tb(error.__traceback__) if frame.filename == "tank.py"]
        line = frames[-1].lineno if frames else None
        column = None
        message = "Python exceeded its execution time limit." if isinstance(error, _TankTimeout) else f"{type(error).__name__}: {error}"
    return _json.dumps({"error": {
        "code": code, "message": message[:1500], "line": line, "column": column,
    }})


def _create_tank_runner(source, execution_ms):
    try:
        code = compile(source, "tank.py", "exec")
    except SyntaxError as error:
        return _error("COMPILE_ERROR", error)

    original_import = _builtins.__import__

    def import_module(name, *args, **kwargs):
        if name.split(".")[0] not in _ALLOWED_IMPORTS:
            raise ImportError("Only the documented Python standard library modules are available.")
        return original_import(name, *args, **kwargs)

    safe_builtins = dict(vars(_builtins))
    for name in ("open", "input", "breakpoint", "help", "exit", "quit"):
        safe_builtins.pop(name, None)
    safe_builtins["__import__"] = import_module
    namespace = {"__builtins__": safe_builtins, "__name__": "tank"}
    clock = _time.monotonic
    set_trace = _sys.settrace

    def run_tick(snapshot_json):
        snapshot = _json.loads(snapshot_json)
        # Fresh tuple records prevent edits from changing the next engine snapshot.
        Position = _collections.namedtuple("Position", "x y")
        Tank = _collections.namedtuple("Tank", "id name x y rotation health")
        Bullet = _collections.namedtuple("Bullet", "id owner_id x y rotation")
        action = []

        def submit(command):
            if not action:
                action.append(command)

        def make_action(command):
            def perform_action():
                submit(command)
            return perform_action

        for python_name, command in _ACTIONS:
            namespace[python_name] = make_action(command)
        namespace.update({
            "tank_id": snapshot["tankId"],
            "tank_position": Position(**snapshot["tankPosition"]),
            "tank_rotation": snapshot["tankRotation"],
            "tank_health": snapshot["tankHealth"],
            "all_tanks": tuple(Tank(**tank) for tank in snapshot["allTanks"]),
            "all_bullets": tuple(Bullet(
                bullet["id"], bullet["ownerId"], bullet["x"], bullet["y"], bullet["rotation"]
            ) for bullet in snapshot["allBullets"]),
            "arena_width": snapshot["arenaWidth"],
            "arena_height": snapshot["arenaHeight"],
        })
        deadline = clock() + execution_ms / 1000

        def check_time(frame, event, arg):
            if clock() >= deadline:
                raise _TankTimeout()
            return check_time

        try:
            set_trace(check_time)
            exec(code, namespace)
        except _TankTimeout as error:
            return _error("EXECUTION_TIMEOUT", error)
        except BaseException as error:
            return _error("RUNTIME_ERROR", error)
        finally:
            set_trace(None)
        return _json.dumps({"action": action[0] if action else None})

    return run_tick


_create_tank_runner
