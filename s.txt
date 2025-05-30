



const XLSX = require('xlsx');
const { spawnSync, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const filePath = path.join(__dirname, '../data/sms_list.xlsx');
const workbook = XLSX.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Get default SMS package name
const getDefaultSmsPackage = () => {
  try {
    return execSync('adb shell settings get secure sms_default_application')
      .toString()
      .trim();
  } catch (e) {
    console.error('❌ Failed to get default SMS app. Using fallback.');
    return 'com.android.messaging'; // Fallback for most devices
  }
};

const SMS_PACKAGE = getDefaultSmsPackage();
console.log(`📱 Using SMS package: ${SMS_PACKAGE}`);

// Function to send key events
const sendKeyEvent = (keyCode, delay = 500) => {
  spawnSync('adb', ['shell', 'input', 'keyevent', keyCode.toString()], { stdio: 'inherit' });
  return wait(delay);
};

// Function to handle image sending via MMS
const sendImage = async (imagePath, phone) => {
  if (!fs.existsSync(imagePath)) {
    console.error(`❌ Image not found: ${imagePath}`);
    return false;
  }

  const devicePath = `/sdcard/Download/${path.basename(imagePath)}`;
  const pushResult = spawnSync('adb', ['push', imagePath, devicePath], { stdio: 'inherit' });
  
  if (pushResult.status !== 0) {
    console.error('❌ Failed to push image to device');
    return false;
  }

  const intentArgs = [
    'shell', 'am', 'start',
    '-a', 'android.intent.action.SEND',
    '-t', 'image/*',
    '--eu', 'android.intent.extra.STREAM', `file://${devicePath}`,
    '-e', 'address', phone,
    '-n', `${SMS_PACKAGE}/.ui.ComposeMessageActivity`,
    '--ez', 'exit_on_sent', 'true',
    '--ez', 'force_sms', 'true'
  ];

  console.log(`📸 Image intent: adb ${intentArgs.join(' ')}`);
  const intentResult = spawnSync('adb', intentArgs, { stdio: 'inherit' });
  return intentResult.status === 0;
};

// Function to handle location sharing
const sendLocation = async (lat, lon, phone) => {
  const geoUri = `geo:${lat},${lon}?q=${lat},${lon}`;
  const intentArgs = [
    'shell', 'am', 'start',
    '-a', 'android.intent.action.SENDTO',
    '-d', `smsto:${phone}`,
    '--es', 'sms_body', `Location: ${lat},${lon}`,
    '-n', `${SMS_PACKAGE}/.ui.ComposeMessageActivity`,
    '--ez', 'exit_on_sent', 'true'
  ];

  console.log(`📍 Location intent: adb ${intentArgs.join(' ')}`);
  const result = spawnSync('adb', intentArgs, { stdio: 'inherit' });
  return result.status === 0;
};

(async () => {
  for (const [index, row] of data.entries()) {
    console.log(`\nProcessing row ${index + 1}/${data.length}`);
    const rawPhone = String(row.PhoneNumber || '');
    const phone = rawPhone.replace(/[^+\d]/g, '').trim();
    let message = String(row.Message || '').trim();
    const imagePath = row.ImagePath ? path.resolve(String(row.ImagePath)) : null;
    const latitude = parseFloat(row.Latitude);
    const longitude = parseFloat(row.Longitude);

    console.log(`📞 Raw phone: "${rawPhone}", Cleaned: "${phone}"`);

    if (!phone) {
      console.error(`❌ Invalid phone number: ${JSON.stringify(row)}`);
      continue;
    }

    let contentAvailable = false;
    
    // Send location if available
    if (!isNaN(latitude) && !isNaN(longitude)) {
      console.log(`📍 Sending location to ${phone}`);
      if (await sendLocation(latitude, longitude, phone)) {
        contentAvailable = true;
        await wait(3000);
        await sendKeyEvent(66); // ENTER to send
        console.log(`✅ Location sent to ${phone}`);
      } else {
        console.error(`❌ Failed to send location to ${phone}`);
      }
    }
    
    // Send image if available
    if (imagePath) {
      console.log(`🖼️ Sending image to ${phone}`);
      if (await sendImage(imagePath, phone)) {
        contentAvailable = true;
        await wait(5000); // Longer wait for image loading
        
        // Simulate clicks to ensure proper sending
        await sendKeyEvent(61); // TAB to focus send button
        await wait(1000);
        await sendKeyEvent(66); // ENTER to send
        console.log(`✅ Image sent to ${phone}`);
      } else {
        console.error(`❌ Failed to send image to ${phone}`);
      }
    }
    
    // Send text message if available
    if (message) {
      console.log(`📤 Sending SMS to ${phone}`);
      const quotedMessage = `"${message.replace(/"/g, '\\"')}"`;
      const adbArgs = [
        'shell', 'am', 'start',
        '-a', 'android.intent.action.SENDTO',
        '-d', `smsto:${phone}`,
        '--es', 'sms_body', quotedMessage,
        '-n', `${SMS_PACKAGE}/.ui.ComposeMessageActivity`,
        '--ez', 'exit_on_sent', 'true'
      ];

      console.log(`💬 Text intent: adb ${adbArgs.join(' ')}`);
      const result = spawnSync('adb', adbArgs, { stdio: 'inherit' });
      
      if (result.status === 0) {
        contentAvailable = true;
        await wait(2000);
        await sendKeyEvent(61); // TAB to focus send button
        await sendKeyEvent(66); // ENTER to send
        console.log(`✅ Text message sent to ${phone}`);
      } else {
        console.error(`❌ Failed to start SMS intent for ${phone}`);
      }
    }

    if (!contentAvailable) {
      console.error(`❌ No valid content to send for ${phone}`);
      continue;
    }

    await wait(3000); // Wait before next operation
  }
  console.log('\n✅ All messages processed!');
})();