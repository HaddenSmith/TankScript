package experiment;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.io.StringWriter;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.URI;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.FileObject;
import javax.tools.ForwardingJavaFileManager;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileManager;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.ToolProvider;

/** Trusted experiment scaffolding; deliberately independent of TankScript. */
public final class ExperimentBridge {
    public record Snapshot(int tankId, double x, double y, int health) {}
    private static Class<?> tankClass;
    private static Object tank;
    private static Method tick;
    private static int compilations;

    private static final class Source extends SimpleJavaFileObject {
        private final String source;
        Source(String source) {
            super(URI.create("string:///MyTank.java"), Kind.SOURCE);
            this.source = source;
        }
        @Override public CharSequence getCharContent(boolean ignoreEncodingErrors) { return source; }
    }

    private static final class Bytecode extends SimpleJavaFileObject {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        Bytecode(String name, Kind kind) {
            super(URI.create("memory:///" + name.replace('.', '/') + kind.extension), kind);
        }
        @Override public OutputStream openOutputStream() { return bytes; }
    }

    public static String compile(String source) throws Exception {
        tank = null;
        tankClass = null;
        tick = null;
        compilations++;
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new IllegalStateException("The Java 21 runtime has no system compiler");
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        Map<String, Bytecode> classes = new HashMap<>();
        var standard = compiler.getStandardFileManager(diagnostics, null, null);
        try (var manager = new ForwardingJavaFileManager<JavaFileManager>(standard) {
            @Override public JavaFileObject getJavaFileForOutput(Location location, String name,
                    JavaFileObject.Kind kind, FileObject sibling) {
                Bytecode bytecode = new Bytecode(name, kind);
                classes.put(name, bytecode);
                return bytecode;
            }
        }) {
            StringWriter output = new StringWriter();
            boolean successful = compiler.getTask(output, manager, diagnostics,
                List.of("--release", "21", "-proc:none", "-classpath", "/str/bridge.jar"),
                null, List.of(new Source(source))).call();
            StringBuilder json = new StringBuilder("{\"successful\":" + successful + ",\"compilations\":" + compilations
                + ",\"javaVersion\":" + quote(System.getProperty("java.version")) + ",\"diagnostics\":[");
            boolean first = true;
            for (Diagnostic<? extends JavaFileObject> diagnostic : diagnostics.getDiagnostics()) {
                if (!first) json.append(',');
                first = false;
                json.append("{\"line\":").append(diagnostic.getLineNumber())
                    .append(",\"column\":").append(diagnostic.getColumnNumber())
                    .append(",\"kind\":").append(quote(diagnostic.getKind().toString()))
                    .append(",\"message\":").append(quote(diagnostic.getMessage(null))).append('}');
            }
            json.append("],\"output\":").append(quote(output.toString())).append('}');
            if (successful) {
                ClassLoader loader = new ClassLoader(ExperimentBridge.class.getClassLoader()) {
                    @Override protected Class<?> findClass(String name) throws ClassNotFoundException {
                        Bytecode bytecode = classes.get(name);
                        if (bytecode == null) throw new ClassNotFoundException(name);
                        byte[] bytes = bytecode.bytes.toByteArray();
                        return defineClass(name, bytes, 0, bytes.length);
                    }
                };
                // Loading without initialization keeps user static initializers under the construct watchdog.
                tankClass = loader.loadClass("MyTank");
            }
            return json.toString();
        }
    }

    public static void construct() throws Exception {
        if (tankClass == null) throw new IllegalStateException("Compile a tank first");
        tank = tankClass.getDeclaredConstructor().newInstance();
        tick = tankClass.getMethod("tick", Snapshot.class);
    }

    public static String tick(int id, double x, double y, int health) throws Exception {
        if (tank == null || tick == null) throw new IllegalStateException("Construct a tank first");
        try {
            return (String) tick.invoke(tank, new Snapshot(id, x, y, health));
        } catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            throw new RuntimeException(cause.getClass().getName() + ": " + cause.getMessage(), cause);
        }
    }

    // A diagnostic-only bridge deliberately gives guest Java worker-level browser capabilities.
    // Isolation must hold even with this bridge; hiding Java imports is not the boundary.
    public static native String browserProbe();

    public static String quote(String text) {
        if (text == null) return "null";
        StringBuilder result = new StringBuilder("\"");
        for (int index = 0; index < text.length(); index++) {
            char character = text.charAt(index);
            switch (character) {
                case '"' -> result.append("\\\"");
                case '\\' -> result.append("\\\\");
                case '\n' -> result.append("\\n");
                case '\r' -> result.append("\\r");
                case '\t' -> result.append("\\t");
                default -> {
                    if (character < 32) result.append(String.format("\\u%04x", (int) character));
                    else result.append(character);
                }
            }
        }
        return result.append('"').toString();
    }
}
