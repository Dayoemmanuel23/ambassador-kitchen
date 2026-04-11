const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5002;

// Middleware
app.use(cors());
app.use(express.json());

// ✅ MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected Successfully"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err.message));

// ✅ Log loaded environment values for debugging
console.log('📦 Loaded ENV:', {
  MAIL_HOST: process.env.MAIL_HOST,
  MAIL_PORT: process.env.MAIL_PORT,
  MAIL_USER: process.env.MAIL_USER,
  MAIL_SECURE: process.env.MAIL_SECURE
});

// ✅ Nodemailer transporter (reusable)
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT),
  secure: process.env.MAIL_SECURE === 'true', // true for 465
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  },
});

// ✅ Test SMTP connection at startup
transporter.verify((error, success) => {
  if (error) {
    console.error('🚨 SMTP Connection Failed!');
    console.error('🧠 Possible causes:');
    console.error('- Wrong MAIL_HOST, MAIL_PORT, or MAIL_SECURE in .env');
    console.error('- Firewall blocking outbound port 465 or 587');
    console.error('- Invalid mail credentials');
    console.error('🔍 Full Error:', error.message);
  } else {
    console.log('📨 SMTP Server Ready to Send Emails ✅');
  }
});

// ===== Mongoose Contact Schema =====
const contactSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Name is required'] },
  email: { 
    type: String, 
    required: [true, 'Email is required'],
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  phone: { type: String, default: '' },
  
  // 👇 FIXED: Enum removed so any event name is accepted
  eventType: { 
    type: String,
    default: ''
  },
  
  message: { type: String, required: [true, 'Message is required'] },
  ipAddress: { type: String },
  status: { type: String, enum: ['new', 'read', 'replied'], default: 'new' }
}, { timestamps: true });

const Contact = mongoose.model('Contact', contactSchema);

// ===== Routes =====
app.get('/', (req, res) => {
  res.json({
    message: 'Catering API is running!',
    version: '1.0.0',
    database: mongoose.connection.db?.databaseName || 'Unknown'
  });
});

// ✅ Send test email route
app.get('/api/test-email', async (req, res) => {
  try {
    await transporter.sendMail({
      from: `"Ambassador Kitchen" <${process.env.MAIL_USER}>`,
      to: process.env.MAIL_USER,
      subject: "SMTP Test Successful ✅",
      text: "This email confirms your Truehost SMTP setup works perfectly!"
    });

    console.log('📧 Test email sent successfully!');
    res.json({ success: true, message: 'Test email sent successfully — check your inbox.' });
  } catch (error) {
    console.error('❌ Failed to send test email:', error.message);

    // 👇 Add custom friendly diagnostics
    let hint = 'Please check your SMTP configuration.';
    if (error.code === 'ECONNREFUSED') {
      hint = 'Connection refused — check if MAIL_HOST and MAIL_PORT are correct and reachable.';
    } else if (error.code === 'EAUTH') {
      hint = 'Authentication failed — check MAIL_USER and MAIL_PASS.';
    } else if (error.code === 'ENOTFOUND') {
      hint = 'Mail host not found — verify MAIL_HOST in .env.';
    }

    res.status(500).json({ success: false, error: error.message, hint });
  }
});

// ✅ Contact form submission route
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, phone, eventType, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ success: false, message: 'Name, email, and message are required.' });
    }

    const ipAddress = req.headers['x-forwarded-for'] ||
                      req.connection.remoteAddress ||
                      req.socket.remoteAddress;

    const newContact = new Contact({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone || '',
      eventType: eventType || '',
      message: message.trim(),
      ipAddress
    });

    const savedContact = await newContact.save();
    console.log(`💾 Contact saved: ${savedContact.name} (${savedContact.email})`);

    // Send notification email
    // Wrapped in try/catch so database save succeeds even if email fails
    try {
        await transporter.sendMail({
        from: `"Ambassador Kitchen Contact" <${process.env.MAIL_USER}>`,
        to: process.env.MAIL_USER,
        subject: `New Contact Form Submission from ${savedContact.name}`,
        html: `
            <h2>New Contact Message</h2>
            <p><strong>Name:</strong> ${savedContact.name}</p>
            <p><strong>Email:</strong> ${savedContact.email}</p>
            <p><strong>Phone:</strong> ${savedContact.phone || 'N/A'}</p>
            <p><strong>Event Type:</strong> ${savedContact.eventType || 'N/A'}</p>
            <p><strong>Message:</strong><br>${savedContact.message}</p>
            <hr>
            <p><small>IP Address: ${savedContact.ipAddress}</small></p>
        `
        });
        console.log('📨 Notification email sent successfully.');
    } catch (emailError) {
        console.error('⚠️ Database saved, but email failed:', emailError.message);
    }

    res.status(201).json({
      success: true,
      message: 'Your message has been received. We’ll get back to you soon!',
      data: { id: savedContact._id, name: savedContact.name, email: savedContact.email }
    });

  } catch (error) {
    console.error('❌ Contact submission failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== Health & Contact Count =====
app.get('/api/health', (req, res) => {
  const db = mongoose.connection;
  res.json({
    status: 'OK',
    database: {
      name: db.db?.databaseName || 'Unknown',
      state: db.readyState === 1 ? 'Connected' : 'Disconnected',
      host: db.host || 'Unknown'
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/api/contacts/count', async (req, res) => {
  try {
    const count = await Contact.countDocuments();
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error counting contacts' });
  }
});

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📧 Test Email: http://localhost:${PORT}/api/test-email`);
  console.log(`💬 Contact Form: http://localhost:${PORT}/api/contact`);
});