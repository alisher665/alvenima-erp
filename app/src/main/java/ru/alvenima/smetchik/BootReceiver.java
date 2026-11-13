package ru.alvenima.smetchik;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import java.util.Map;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            SharedPreferences prefs = context.getSharedPreferences("AlarmsData", Context.MODE_PRIVATE);
            long now = System.currentTimeMillis();

            for (Map.Entry<String, ?> entry : prefs.getAll().entrySet()) {
                try {
                    long timestamp = Long.parseLong(entry.getKey());
                    String text = entry.getValue().toString();

                    if (timestamp > now) {
                        Intent alarmIntent = new Intent(context, AlarmReceiver.class);
                        alarmIntent.putExtra("message", text);
                        alarmIntent.putExtra("timestamp", timestamp);

                        int requestCode = (int) (timestamp / 1000);
                        PendingIntent pendingIntent = PendingIntent.getBroadcast(context, requestCode, alarmIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            if (alarmManager.canScheduleExactAlarms()) {
                                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, timestamp, pendingIntent);
                            }
                        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, timestamp, pendingIntent);
                        } else {
                            alarmManager.setExact(AlarmManager.RTC_WAKEUP, timestamp, pendingIntent);
                        }
                    } else {
                        prefs.edit().remove(entry.getKey()).apply();
                    }
                } catch (Exception ignored) {}
            }
        }
    }
}