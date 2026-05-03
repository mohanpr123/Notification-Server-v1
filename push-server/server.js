const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error(
    'Missing FIREBASE_SERVICE_ACCOUNT. Set it to your Firebase service account JSON before running npm start.',
  );
  process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'attendance-push-server' });
});

app.post('/send-attendance-push', async (req, res) => {
  try {
    const { deviceId, token, employeeId } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Missing token' });
    }

    const message = {
      token,
      notification: {
        title: 'Attendance Check',
        body: 'Tap to mark your attendance',
      },
      data: {
        action: 'SEND_LOCATION',
        deviceId: deviceId || '',
        employeeId: String(employeeId || ''),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'attendance',
          clickAction: 'FCM_PLUGIN_ACTIVITY',
        },
      },
    };

    const messageId = await admin.messaging().send(message);

    res.json({
      success: true,
      messageId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message,
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Push server running on port ${port}`);
});
