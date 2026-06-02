const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ========== 数据存储 ==========
// 使用内存存储作为默认，如果配置了 MongoDB 则使用 MongoDB
let useMongo = false;
let Transaction, Contact;

// 内存存储
const memStore = {
    transactions: [],
    contacts: [],
    _nextId: 1000
};

function genId() { return String(memStore._nextId++); }

// 尝试连接 MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
    const mongoose = require('mongoose');
    mongoose.connect(MONGODB_URI)
        .then(() => {
            console.log('✅ MongoDB 连接成功，使用云端存储');
            useMongo = true;

            const TransactionSchema = new mongoose.Schema({
                date: String,
                type: String,          // 'income' | 'expense' | 'personal'
                source: String,        // 收入来源: 微信/支付宝/现金/银行卡
                category: String,      // 支出类别 或 '家庭开支'
                item: String,          // 项目/菜品/明细
                amount: Number,
                settlement: { type: String, default: '现结' },  // 现结/未付
                note: { type: String, default: '' }
            }, { timestamps: true });
            Transaction = mongoose.model('Transaction', TransactionSchema);

            const ContactSchema = new mongoose.Schema({
                name: String,
                type: String,          // 'customer' | 'supplier'
                info: { type: String, default: '' }
            }, { timestamps: true });
            Contact = mongoose.model('Contact', ContactSchema);
        })
        .catch(err => {
            console.error('❌ MongoDB 连接失败:', err.message);
            console.log('⚠️  降级为内存存储（数据重启后丢失）');
        });
} else {
    console.log('⚠️  未配置 MONGODB_URI，使用内存存储（数据重启后丢失）');
    console.log('💡 提示: 设置 MONGODB_URI 环境变量以启用持久化存储');
}

// ========== API 路由 ==========

// --- 交易记录 ---
app.get('/api/transactions', async (req, res) => {
    try {
        if (useMongo && Transaction) {
            const data = await Transaction.find().sort({ date: -1 }).lean();
            return res.json(data);
        }
        res.json([...memStore.transactions].reverse());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/transactions', async (req, res) => {
    try {
        const { date, type, source, category, item, amount, settlement, note } = req.body;
        if (!date || !type || amount == null) {
            return res.status(400).json({ error: '缺少必要字段 (date, type, amount)' });
        }
        if (useMongo && Transaction) {
            const doc = new Transaction({ date, type, source, category, item, amount, settlement: settlement || '现结', note: note || '' });
            await doc.save();
            return res.json({ success: true, record: doc.toObject() });
        }
        const record = {
            _id: genId(),
            date, type,
            source: source || '',
            category: category || '',
            item: item || '',
            amount: Number(amount),
            settlement: settlement || '现结',
            note: note || ''
        };
        memStore.transactions.push(record);
        res.json({ success: true, record });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/transactions/:id', async (req, res) => {
    try {
        if (useMongo && Transaction) {
            await Transaction.findByIdAndDelete(req.params.id);
            return res.json({ success: true });
        }
        const idx = memStore.transactions.findIndex(t => t._id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: '记录不存在' });
        memStore.transactions.splice(idx, 1);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/transactions', async (req, res) => {
    try {
        if (useMongo && Transaction) {
            await Transaction.deleteMany({});
            return res.json({ success: true });
        }
        memStore.transactions = [];
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 联系人 ---
app.get('/api/contacts', async (req, res) => {
    try {
        if (useMongo && Contact) {
            const data = await Contact.find().lean();
            return res.json(data);
        }
        res.json([...memStore.contacts]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/contacts', async (req, res) => {
    try {
        const { name, type, info } = req.body;
        if (!name) return res.status(400).json({ error: '缺少名称' });
        if (useMongo && Contact) {
            const doc = new Contact({ name, type: type || 'customer', info: info || '' });
            await doc.save();
            return res.json({ success: true, record: doc.toObject() });
        }
        const record = { _id: genId(), name, type: type || 'customer', info: info || '' };
        memStore.contacts.push(record);
        res.json({ success: true, record });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/contacts/:id', async (req, res) => {
    try {
        if (useMongo && Contact) {
            await Contact.findByIdAndDelete(req.params.id);
            return res.json({ success: true });
        }
        const idx = memStore.contacts.findIndex(c => c._id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: '不存在' });
        memStore.contacts.splice(idx, 1);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 健康检查 ---
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        storage: useMongo ? 'mongodb' : 'memory',
        transactions: useMongo ? '(mongo)' : memStore.transactions.length,
        contacts: useMongo ? '(mongo)' : memStore.contacts.length
    });
});

// --- 导出 CSV ---
app.get('/api/export/csv', async (req, res) => {
    try {
        let data;
        if (useMongo && Transaction) {
            data = await Transaction.find().sort({ date: -1 }).lean();
        } else {
            data = [...memStore.transactions].sort((a, b) => b.date.localeCompare(a.date));
        }
        let csv = '\uFEFF日期,类型,来源/类别,项目,金额,结算,备注\n';
        data.forEach(t => {
            const srcCat = t.type === 'income' ? (t.source || '') : (t.type === 'expense' ? (t.category || '') : '家庭');
            csv += `${t.date},${t.type},${srcCat},${t.item || ''},${t.amount},${t.settlement || ''},${t.note || ''}\n`;
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=餐厅记账.csv');
        res.send(csv);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== 静态文件 ==========
// 从当前目录（E:\public）提供静态文件
app.use(express.static(__dirname));

// SPA fallback: 所有非 API 路径返回 index.html
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: '接口不存在' });
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ========== 启动 ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🍜 珠源朱记账系统 服务端已启动`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log(`📦 存储模式: ${useMongo ? 'MongoDB 云端' : '内存（重启丢失）'}\n`);
});
