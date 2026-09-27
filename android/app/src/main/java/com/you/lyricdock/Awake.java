package com.you.lyricdock;

// Runs MainActivity.applyAwake() on the UI thread (top-level class: the Gradle-free build avoids inner classes).
class Awake implements Runnable {
    private final MainActivity a;
    private final boolean on;
    Awake(MainActivity a, boolean on) { this.a = a; this.on = on; }
    public void run() { a.applyAwake(on); }
}
