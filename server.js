const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ========== 数据存储 ==========
let useMongo = false;
let Transaction, Contact, User;

// 内存存储
const memStore = {
    transactions: [],
    contacts: [],
    users: [],
    _nextId: 1000
};
function genId() { return String(memStore._nextId++); }

// 默认用户
const DEFAULT_USERS = [
    { username: 'admin', password: 'admin123', role: 'admin', permissions: { canAdd: true, canEdit: true, canDelete: true, canManageUsers: true } },
    { username: 'staff', password: 'staff123', role: 'staff', permissions: { canAdd: true, canEdit: false, canDelete: false, canManageUsers: false } }
];

// 初始化内存用户
memStore.users = JSON.parse(JSON.stringify(DEFAULT_USERS));

// 尝试连接 MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
    const mongoose = require('mongoose');
    mongoose.connect(MONGODB_URI)
        .then(async () => {
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
                info: { type: String, default: '' },
                phone: { type: String, default: '' },
                address: { type: String, default: '' }
            }, { timestamps: true });
            Contact = mongoose.model('Contact', ContactSchema);

            const UserSchema = new mongoose.Schema({
                username: { type: String, required: true, unique: true },
                password: { type: String, required: true },
                role: { type: String, default: 'staff' },
                permissions: {
                    canAdd: { type: Boolean, default: true },
                    canEdit: { type: Boolean, default: false },
                    canDelete: { type: Boolean, default: false },
                    canManageUsers: { type: Boolean, default: false }
                }
            }, { timestamps: true });
            User = mongoose.model('User', UserSchema);

            // 初始化默认用户（仅在数据库为空时）
            const userCount = await User.countDocuments();
            if (userCount === 0) {
                await User.insertMany(DEFAULT_USERS);
                console.log('✅ 默认用户已初始化');
            }
        })
        .catch(err => {
            console.error('❌ MongoDB 连接失败:', err.message);
            console.log('⚠️  降级为内存存储（数据重启后丢失）');
        });
} else {
    console.log('⚠️  未配置 MONGODB_URI，使用内存存储（数据重启后丢失）');
    console.log('💡 提示: 设置 MONGODB_URI 环境变量以启用持久化存储');
}

// ========== 认证 API ==========
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: '缺少用户名或密码' });

        let user;
        if (useMongo && User) {
            user = await User.findOne({ username, password }).lean();
        } else {
            user = memStore.users.find(u => u.username === username && u.password === password);
        }

        if (user) {
            const result = { ...user };
            delete result.password;
            delete result._id;
            delete result.__v;
            return res.json({ success: true, user: result });
        }
        res.status(401).json({ error: '用户名或密码错误' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== 用户管理 API ==========
app.get('/api/users', async (req, res) => {
    try {
        if (useMongo && User) {
            const data = await User.find().select('-password').lean();
            return res.json(data);
        }
        const data = memStore.users.map(u => {
            const { password, ...rest } = u;
            return rest;
        });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users', async (req, res) => {
    try {
        const { username, password, role, permissions } = req.body;
        if (!username || !password) return res.status(400).json({ error: '缺少用户名或密码' });

        if (useMongo && User) {
            const exists = await User.findOne({ username });
            if (exists) return res.status(400).json({ error: '用户名已存在' });
            const doc = new User({ username, password, role: role || 'staff', permissions });
            await doc.save();
            const result = doc.toObject();
            delete result.password;
            return res.json({ success: true, user: result });
        }
        if (memStore.users.find(u => u.username === username)) {
            return res.status(400).json({ error: '用户名已存在' });
        }
        const record = { username, password, role: role || 'staff', permissions: permissions || { canAdd: true, canEdit: false, canDelete: false, canManageUsers: false } };
        memStore.users.push(record);
        const { password: _, ...rest } = record;
        res.json({ success: true, user: rest });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/users/:username', async (req, res) => {
    try {
        const { password, role, permissions } = req.body;
        if (useMongo && User) {
            const update = {};
            if (password) update.password = password;
            if (role) update.role = role;
            if (permissions) update.permissions = permissions;
            const doc = await User.findOneAndUpdate({ username: req.params.username }, update, { new: true }).select('-password').lean();
            if (!doc) return res.status(404).json({ error: '用户不存在' });
            return res.json({ success: true, user: doc });
        }
        const user = memStore.users.find(u => u.username === req.params.username);
        if (!user) return res.status(404).json({ error: '用户不存在' });
        if (password) user.password = password;
        if (role) user.role = role;
        if (permissions) user.permissions = { ...user.permissions, ...permissions };
        const { password: _, ...rest } = user;
        res.json({ success: true, user: rest });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/users/:username', async (req, res) => {
    try {
        if (useMongo && User) {
            await User.findOneAndDelete({ username: req.params.username });
            return res.json({ success: true });
        }
        memStore.users = memStore.users.filter(u => u.username !== req.params.username);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== 交易记录 API ==========
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

// 修改交易记录
app.put('/api/transactions/:id', async (req, res) => {
    try {
        const { date, type, source, category, item, amount, settlement, note } = req.body;
        if (useMongo && Transaction) {
            const doc = await Transaction.findByIdAndUpdate(req.params.id, {
                date, type, source, category, item, amount, settlement, note
            }, { new: true }).lean();
            if (!doc) return res.status(404).json({ error: '记录不存在' });
            return res.json({ success: true, record: doc });
        }
        const idx = memStore.transactions.findIndex(t => t._id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: '记录不存在' });
        const record = memStore.transactions[idx];
        if (date !== undefined) record.date = date;
        if (type !== undefined) record.type = type;
        if (source !== undefined) record.source = source;
        if (category !== undefined) record.category = category;
        if (item !== undefined) record.item = item;
        if (amount !== undefined) record.amount = Number(amount);
        if (settlement !== undefined) record.settlement = settlement;
        if (note !== undefined) record.note = note;
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

// ========== 联系人 API ==========
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
        const { name, type, info, phone, address } = req.body;
        if (!name) return res.status(400).json({ error: '缺少名称' });
        if (useMongo && Contact) {
            const doc = new Contact({ name, type: type || 'customer', info: info || '', phone: phone || '', address: address || '' });
            await doc.save();
            return res.json({ success: true, record: doc.toObject() });
        }
        const record = { _id: genId(), name, type: type || 'customer', info: info || '', phone: phone || '', address: address || '' };
        memStore.contacts.push(record);
        res.json({ success: true, record });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/contacts/:id', async (req, res) => {
    try {
        const { name, type, info, phone, address } = req.body;
        if (useMongo && Contact) {
            const doc = await Contact.findByIdAndUpdate(req.params.id, { name, type, info, phone, address }, { new: true }).lean();
            if (!doc) return res.status(404).json({ error: '联系人不存在' });
            return res.json({ success: true, record: doc });
        }
        const idx = memStore.contacts.findIndex(c => c._id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: '联系人不存在' });
        const record = memStore.contacts[idx];
        if (name !== undefined) record.name = name;
        if (type !== undefined) record.type = type;
        if (info !== undefined) record.info = info;
        if (phone !== undefined) record.phone = phone;
        if (address !== undefined) record.address = address;
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

// ========== 查询统计 API ==========
// 未付应付款按供应商汇总
app.get('/api/query/unpaid-by-supplier', async (req, res) => {
    try {
        if (useMongo && Transaction) {
            const data = await Transaction.aggregate([
                { $match: { type: 'expense', settlement: '未付' } },
                { $group: { _id: '$note', total: { $sum: '$amount' }, count: { $sum: 1 }, items: { $push: { date: '$date', item: '$item', amount: '$amount', category: '$category' } } } },
                { $sort: { total: -1 } }
            ]);
            return res.json(data.map(d => ({
                supplier: d._id || '未指定供应商',
                total: d.total,
                count: d.count,
                items: d.items
            })));
        }
        const group = {};
        memStore.transactions.filter(t => t.type === 'expense' && t.settlement === '未付').forEach(t => {
            const key = t.note || '未指定供应商';
            if (!group[key]) group[key] = { total: 0, count: 0, items: [] };
            group[key].total += t.amount;
            group[key].count++;
            group[key].items.push({ date: t.date, item: t.item, amount: t.amount, category: t.category, id: t._id });
        });
        const result = Object.entries(group).map(([supplier, data]) => ({ supplier, ...data }))
            .sort((a, b) => b.total - a.total);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== 健康检查 ==========
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        storage: useMongo ? 'mongodb' : 'memory',
        transactions: useMongo ? '(mongo)' : memStore.transactions.length,
        contacts: useMongo ? '(mongo)' : memStore.contacts.length
    });
});

// ========== 导出 CSV ==========
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
