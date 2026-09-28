const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const MONGO_URI = 'mongodb+srv://adrewards_user:SecurePass123@cluster0.mongodb.net/?appName=Cluster0';

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('✅ MongoDB Connected')).catch(err => console.error('❌ MongoDB Error:', err));

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  email: { type: String, unique: true, required: true },
  password: String,
  balance: { type: Number, default: 0 },
  totalEarned: { type: Number, default: 0 },
  referralCode: { type: String, unique: true },
  referredBy: String,
  clicksToday: { type: Number, default: 0 },
  lastClickDate: Date,
  withdrawalRequests: [{ amount: Number, status: String, date: Date }],
  createdAt: { type: Date, default: Date.now }
});

// Ad Schema
const adSchema = new mongoose.Schema({
  title: String,
  description: String,
  url: String,
  image: String,
  reward: { type: Number, default: 10 },
  active: { type: Boolean, default: true },
  dailyLimit: { type: Number, default: 10 },
  clicksToday: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// Click Log Schema
const clickLogSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  adId: mongoose.Schema.Types.ObjectId,
  amount: Number,
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Ad = mongoose.model('Ad', adSchema);
const ClickLog = mongoose.model('ClickLog', clickLogSchema);

function generateReferralCode() {
  return 'REF-' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

// ========== AUTH ROUTES ==========

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, email, password, referralCode } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) return res.status(400).json({ error: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newReferralCode = generateReferralCode();

    const user = new User({
      username,
      email,
      password: hashedPassword,
      referralCode: newReferralCode,
      referredBy: referralCode || null
    });

    await user.save();

    // Add referral bonus if applicable
    if (referralCode) {
      const referrer = await User.findOne({ referralCode });
      if (referrer) {
        await User.updateOne({ _id: referrer._id }, { $inc: { balance: 5 } });
      }
    }

    const token = jwt.sign({ userId: user._id }, 'secret_key_adrewards', { expiresIn: '30d' });
    res.json({ success: true, token, referralCode: newReferralCode });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid password' });

    const token = jwt.sign({ userId: user._id }, 'secret_key_adrewards', { expiresIn: '30d' });
    res.json({ success: true, token, username: user.username });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== ADS ROUTES ==========

app.get('/api/ads', async (req, res) => {
  try {
    const ads = await Ad.find({ active: true });
    res.json(ads);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/ads/click', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const decoded = jwt.verify(token, 'secret_key_adrewards');
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { adId } = req.body;
    const ad = await Ad.findById(adId);
    if (!ad) return res.status(404).json({ error: 'Ad not found' });

    // Check daily limit
    const today = new Date().toDateString();
    if (user.lastClickDate && user.lastClickDate.toDateString() === today) {
      if (user.clicksToday >= 10) {
        return res.status(400).json({ error: 'Daily limit reached (10 clicks)' });
      }
    } else {
      user.clicksToday = 0;
    }

    // Record click
    const clickLog = new ClickLog({
      userId: user._id,
      adId: ad._id,
      amount: 10
    });
    await clickLog.save();

    // Update user balance
    await User.updateOne(
      { _id: user._id },
      { 
        $inc: { balance: 10, totalEarned: 10, clicksToday: 1 },
        $set: { lastClickDate: new Date() }
      }
    );

    // Update ad clicks
    await Ad.updateOne({ _id: ad._id }, { $inc: { clicksToday: 1 } });

    res.json({ success: true, earned: 10 });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== DASHBOARD ROUTE ==========

app.get('/api/dashboard', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const decoded = jwt.verify(token, 'secret_key_adrewards');
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      username: user.username,
      balance: user.balance,
      totalEarned: user.totalEarned,
      referralCode: user.referralCode,
      clicksToday: user.clicksToday,
      withdrawalRequests: user.withdrawalRequests
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== WITHDRAWAL ROUTE ==========

app.post('/api/withdrawal', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const decoded = jwt.verify(token, 'secret_key_adrewards');
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { amount } = req.body;
    if (amount > user.balance) return res.status(400).json({ error: 'Insufficient balance' });

    await User.updateOne(
      { _id: user._id },
      { 
        $inc: { balance: -amount },
        $push: { withdrawalRequests: { amount, status: 'pending', date: new Date() } }
      }
    );

    res.json({ success: true, message: 'Withdrawal request submitted' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== FRONTEND ROUTES ==========

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AdRewards - Click. Earn. Repeat.</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .navbar { background: white; padding: 20px; border-radius: 10px; margin-bottom: 40px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .navbar h1 { color: #667eea; font-size: 28px; }
    .navbar a { color: white; background: #667eea; padding: 10px 20px; border-radius: 5px; text-decoration: none; margin-left: 10px; }
    .hero { background: white; padding: 60px 40px; border-radius: 10px; text-align: center; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .hero h1 { color: #333; font-size: 48px; margin-bottom: 20px; }
    .hero p { color: #666; font-size: 18px; margin-bottom: 30px; }
    .buttons { display: flex; gap: 15px; justify-content: center; }
    .btn { padding: 15px 40px; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; font-size: 16px; text-decoration: none; }
    .btn-primary { background: #667eea; color: white; }
    .btn-secondary { background: #764ba2; color: white; }
    .features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 40px; }
    .feature { background: #f5f5f5; padding: 20px; border-radius: 10px; text-align: center; }
    .feature h3 { color: #667eea; margin-bottom: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="navbar">
      <h1>💰 AdRewards</h1>
      <div>
        <a href="/login.html">Login</a>
        <a href="/signup.html">Sign Up</a>
      </div>
    </div>
    <div class="hero">
      <h1>Click. Earn. Repeat.</h1>
      <p>Earn $10 for every ad you click. Up to $100 per day!</p>
      <div class="buttons">
        <a href="/signup.html" class="btn btn-primary">Start Earning Now</a>
        <a href="/login.html" class="btn btn-secondary">I Already Have Account</a>
      </div>
      <div class="features">
        <div class="feature">
          <h3>💵 $10 Per Click</h3>
          <p>Each ad click earns you $10</p>
        </div>
        <div class="feature">
          <h3>📈 Daily Limit</h3>
          <p>Up to 10 clicks per day = $100</p>
        </div>
        <div class="feature">
          <h3>🎁 Referral Bonus</h3>
          <p>$5 for each friend you refer</p>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`);
});

app.get('/signup.html', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Sign Up - AdRewards</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .form-container { background: white; padding: 40px; border-radius: 10px; width: 90%; max-width: 400px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .form-container h1 { color: #667eea; margin-bottom: 30px; text-align: center; }
    .form-group { margin-bottom: 20px; }
    .form-group label { display: block; margin-bottom: 8px; font-weight: bold; color: #333; }
    .form-group input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px; }
    .form-group input:focus { outline: none; border-color: #667eea; }
    .btn { width: 100%; padding: 12px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; font-size: 16px; }
    .btn:hover { background: #764ba2; }
    .msg { margin-top: 15px; padding: 12px; background: #d4edda; color: #155724; text-align: center; display: none; border-radius: 5px; }
    .link { text-align: center; margin-top: 15px; }
    .link a { color: #667eea; text-decoration: none; }
  </style>
</head>
<body>
  <div class="form-container">
    <h1>Create Account</h1>
    <form id="form">
      <div class="form-group">
        <label>Username:</label>
        <input type="text" id="username" required>
      </div>
      <div class="form-group">
        <label>Email:</label>
        <input type="email" id="email" required>
      </div>
      <div class="form-group">
        <label>Password:</label>
        <input type="password" id="password" required>
      </div>
      <div class="form-group">
        <label>Referral Code (Optional):</label>
        <input type="text" id="referralCode">
      </div>
      <button type="submit" class="btn">Sign Up</button>
    </form>
    <div id="msg" class="msg"></div>
    <div class="link">
      Already have account? <a href="/login.html">Login</a>
    </div>
  </div>
  <script>
    document.getElementById('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value,
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
          referralCode: document.getElementById('referralCode').value
        })
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('token', data.token);
        document.getElementById('msg').style.display = 'block';
        document.getElementById('msg').textContent = 'Signup Success! Referral Code: ' + data.referralCode;
        setTimeout(() => window.location.href = '/dashboard.html', 2000);
      } else {
        alert(data.error);
      }
    });
  </script>
</body>
</html>`);
});

app.get('/login.html', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Login - AdRewards</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .form-container { background: white; padding: 40px; border-radius: 10px; width: 90%; max-width: 400px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .form-container h1 { color: #667eea; margin-bottom: 30px; text-align: center; }
    .form-group { margin-bottom: 20px; }
    .form-group label { display: block; margin-bottom: 8px; font-weight: bold; color: #333; }
    .form-group input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px; }
    .form-group input:focus { outline: none; border-color: #667eea; }
    .btn { width: 100%; padding: 12px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; font-size: 16px; }
    .btn:hover { background: #764ba2; }
    .link { text-align: center; margin-top: 15px; }
    .link a { color: #667eea; text-decoration: none; }
  </style>
</head>
<body>
  <div class="form-container">
    <h1>Login</h1>
    <form id="form">
      <div class="form-group">
        <label>Email:</label>
        <input type="email" id="email" required>
      </div>
      <div class="form-group">
        <label>Password:</label>
        <input type="password" id="password" required>
      </div>
      <button type="submit" class="btn">Login</button>
    </form>
    <div class="link">
      Don't have account? <a href="/signup.html">Sign Up</a>
    </div>
  </div>
  <script>
    document.getElementById('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('email').value,
          password: document.getElementById('password').value
        })
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('token', data.token);
        window.location.href = '/dashboard.html';
      } else {
        alert(data.error);
      }
    });
  </script>
</body>
</html>`);
});

app.get('/dashboard.html', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Dashboard - AdRewards</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma; background: #f5f5f5; }
    .navbar { background: #667eea; color: white; padding: 20px; text-align: center; }
    .container { max-width: 1200px; margin: 20px auto; padding: 20px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .stat-card { background: white; padding: 20px; border-radius: 10px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .stat-card h3 { color: #667eea; }
    .stat-card p { font-size: 28px; font-weight: bold; color: #333; }
    .ads-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px; }
    .ad-card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .ad-card h3 { color: #333; margin-bottom: 10px; }
    .ad-card p { color: #666; margin-bottom: 15px; }
    .ad-btn { background: #667eea; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; width: 100%; font-weight: bold; }
    .ad-btn:hover { background: #764ba2; }
    .withdrawal { background: white; padding: 20px; border-radius: 10px; margin-top: 30px; }
    .withdrawal input { width: 100%; padding: 10px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 5px; }
    .btn-withdraw { background: #28a745; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; }
    .btn-logout { background: #dc3545; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; float: right; }
  </style>
</head>
<body>
  <div class="navbar">
    <h1>💰 AdRewards Dashboard</h1>
  </div>
  <div class="container">
    <div class="stats">
      <div class="stat-card">
        <h3>💵 Balance</h3>
        <p id="balance">$0</p>
      </div>
      <div class="stat-card">
        <h3>📈 Total Earned</h3>
        <p id="totalEarned">$0</p>
      </div>
      <div class="stat-card">
        <h3>👥 Referral Code</h3>
        <p id="referralCode">REF-XXX</p>
      </div>
      <div class="stat-card">
        <h3>🔗 Clicks Today</h3>
        <p id="clicksToday">0/10</p>
      </div>
    </div>
    <h2>Available Ads</h2>
    <div class="ads-grid" id="adsContainer"></div>
    <div class="withdrawal">
      <h2>Request Withdrawal</h2>
      <input type="number" id="withdrawAmount" placeholder="Enter amount in USD" min="1">
      <button class="btn-withdraw" onclick="requestWithdrawal()">Request Withdrawal</button>
      <button class="btn-logout" onclick="logout()">Logout</button>
    </div>
  </div>
  <script>
    async function loadDashboard() {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/dashboard', { headers: { 'Authorization': 'Bearer ' + token } });
      const data = await res.json();
      document.getElementById('balance').textContent = '$' + data.balance;
      document.getElementById('totalEarned').textContent = '$' + data.totalEarned;
      document.getElementById('referralCode').textContent = data.referralCode;
      document.getElementById('clicksToday').textContent = data.clicksToday + '/10';
    }
    async function loadAds() {
      const res = await fetch('/api/ads');
      const ads = await res.json();
      const container = document.getElementById('adsContainer');
      ads.forEach(ad => {
        const card = document.createElement('div');
        card.className = 'ad-card';
        card.innerHTML = '<h3>' + ad.title + '</h3><p>' + ad.description + '</p><p><strong>Reward: $' + ad.reward + '</strong></p><button class="ad-btn" onclick="clickAd(\'' + ad._id + '\')">Click Ad</button>';
        container.appendChild(card);
      });
    }
    async function clickAd(adId) {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/ads/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ adId })
      });
      const data = await res.json();
      if (data.success) {
        alert('✅ Earned $' + data.earned);
        loadDashboard();
      } else {
        alert('❌ ' + data.error);
      }
    }
    async function requestWithdrawal() {
      const amount = document.getElementById('withdrawAmount').value;
      if (!amount) return alert('Enter amount');
      const token = localStorage.getItem('token');
      const res = await fetch('/api/withdrawal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ amount: parseFloat(amount) })
      });
      const data = await res.json();
      if (data.success) {
        alert('✅ ' + data.message);
        loadDashboard();
      } else {
        alert('❌ ' + data.error);
      }
    }
    function logout() { localStorage.removeItem('token'); window.location.href = '/'; }
    loadDashboard();
    loadAds();
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log('🚀 AdRewards Server Running on Port ' + PORT);
});
