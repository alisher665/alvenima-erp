package ru.alvenima.smetchik;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {

    private static final int REQUEST_AUDIO_PERMISSION = 101;
    private WebView webView;
    private ServerSocket serverSocket;
    private ExecutorService serverExecutor;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        // Разрешаем доступ к файлам (для локального сервера это не обязательно, но не помешает)
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowContentAccess(true);

        // 1. Настраиваем обработку запросов на микрофон от WebView
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                            == PackageManager.PERMISSION_GRANTED) {
                        // Разрешение уже есть - даем добро WebView
                        request.grant(request.getResources());
                    } else {
                        // Запрашиваем разрешение у пользователя
                        ActivityCompat.requestPermissions(MainActivity.this,
                                new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_AUDIO_PERMISSION);
                        // Отклоняем текущий запрос, чтобы WebView не "висел" в ожидании
                        request.deny();
                    }
                });
            }
        });

        webView.setWebViewClient(new WebViewClient());
        setContentView(webView);

        // 2. Запускаем локальный сервер
        startLocalServer();
    }

    // --- Локальный сервер ---
    private void startLocalServer() {
        serverExecutor = Executors.newSingleThreadExecutor();
        serverExecutor.execute(() -> {
            try {
                // Слушаем только localhost (127.0.0.1) для безопасности
                serverSocket = new ServerSocket(8080, 0, InetAddress.getByName("127.0.0.1"));
                // После запуска сервера загружаем страницу
                runOnUiThread(() -> webView.loadUrl("http://127.0.0.1:8080/index.html"));

                while (!serverSocket.isClosed()) {
                    Socket socket = serverSocket.accept();
                    handleRequest(socket);
                }
            } catch (IOException e) {
                e.printStackTrace();
            }
        });
    }

    private void handleRequest(Socket socket) {
        try {
            InputStream input = socket.getInputStream();
            OutputStream output = socket.getOutputStream();

            // Читаем HTTP-запрос (нам важно только начало)
            byte[] buffer = new byte[2048];
            int bytesRead = input.read(buffer);
            if (bytesRead == -1) return;
            String request = new String(buffer, 0, bytesRead);

            // Определяем, какой файл просят (по умолчанию index.html)
            String filePath = "index.html";
            if (request.startsWith("GET /")) {
                String[] parts = request.split(" ");
                if (parts.length > 1) {
                    String path = parts[1];
                    if (!path.equals("/")) {
                        filePath = path.substring(1);
                    }
                }
            }

            // Пытаемся открыть файл в assets
            try {
                InputStream fileStream = getAssets().open(filePath);
                byte[] fileBytes = new byte[fileStream.available()];
                fileStream.read(fileBytes);
                fileStream.close();

                // Отправляем успешный ответ с правильным MIME-типом
                String mimeType = "text/html";
                if (filePath.endsWith(".js")) mimeType = "application/javascript";
                if (filePath.endsWith(".css")) mimeType = "text/css";
                if (filePath.endsWith(".png")) mimeType = "image/png";
                if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) mimeType = "image/jpeg";
                if (filePath.endsWith(".svg")) mimeType = "image/svg+xml";
                if (filePath.endsWith(".json")) mimeType = "application/json";

                String header = "HTTP/1.1 200 OK\r\n" +
                        "Content-Type: " + mimeType + "\r\n" +
                        "Access-Control-Allow-Origin: *\r\n" + // Важно для некоторых запросов
                        "Connection: close\r\n\r\n";
                output.write(header.getBytes());
                output.write(fileBytes);
            } catch (IOException e) {
                // Если файл не найден - 404
                String header = "HTTP/1.1 404 Not Found\r\n\r\n";
                output.write(header.getBytes());
            }
            output.flush();
            socket.close();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    // --- Обработка результата выдачи разрешения ---
    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_AUDIO_PERMISSION) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Разрешение получено! Нажмите кнопку записи ещё раз.", Toast.LENGTH_LONG).show();
            } else {
                Toast.makeText(this, "Без разрешения микрофона запись невозможна.", Toast.LENGTH_LONG).show();
            }
        }
    }

    // --- Очистка при выходе ---
    @Override
    protected void onDestroy() {
        super.onDestroy();
        try {
            if (serverSocket != null) serverSocket.close();
            if (serverExecutor != null) serverExecutor.shutdown();
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}