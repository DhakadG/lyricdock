package com.you.lyricdock;

// Runs MainActivity.exitKiosk() on the UI thread (top-level class: the Gradle-free build avoids inner classes).
class KioskExit implements Runnable {
    private final MainActivity a;
    KioskExit(MainActivity a) { this.a = a; }
    public void run() { a.exitKiosk(); }
}
