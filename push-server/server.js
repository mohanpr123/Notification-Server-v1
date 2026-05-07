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

async function clearInvalidDeviceToken(deviceId, token) {
  if (!deviceId || !token) {
    return;
  }

  try {
    const deviceRef = admin.firestore().doc(`devices/${deviceId}`);
    const deviceSnapshot = await deviceRef.get();
    if (!deviceSnapshot.exists) {
      console.warn(`Cannot clear token: device document devices/${deviceId} does not exist.`);
      return;
    }

    const device = deviceSnapshot.data();
    if (device?.token !== token) {
      console.warn(`Token mismatch for devices/${deviceId}; not clearing stale token.`);
      return;
    }

    await deviceRef.update({ token: admin.firestore.FieldValue.delete() });
    console.log(`Cleared stale push token for device ${deviceId}.`);
  } catch (clearError) {
    console.error('Failed to clear stale device token:', clearError);
  }
}

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'attendance-push-server' });
});

app.post('/send-attendance-push', async (req, res) => {
  try {
    console.log('send-attendance-push request body:', JSON.stringify(req.body));
    const { attendanceId, deviceId, token, employeeId, checkin } = req.body;

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
        attendanceId: attendanceId || '',
        deviceId: deviceId || '',
        employeeId: String(employeeId || ''),
        checkin: String(checkin || 'IN'),
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
    console.error('Failed to send push notification:', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack,
    });

    if (error?.code === 'messaging/registration-token-not-registered' ||
        error?.code === 'messaging/invalid-registration-token') {
      await clearInvalidDeviceToken(deviceId, token);
    }

    res.status(500).json({
      error: error?.message || 'Unknown error',
      details: error?.code || undefined,
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Push server running on port ${port}`);
});
