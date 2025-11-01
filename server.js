import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const COZE_API_HOST = 'https://api.coze.cn';
const COZE_BOT_ID   = process.env.COZE_BOT_ID;
const COZE_TOKEN    = process.env.COZE_TOKEN;

console.log('[BOOT] COZE_API_HOST =', COZE_API_HOST);
console.log('[BOOT] COZE_BOT_ID =', COZE_BOT_ID);
console.log('[BOOT] COZE_TOKEN first10 =', COZE_TOKEN ? COZE_TOKEN.slice(0, 10) : '(EMPTY)');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'ok', time: Date.now() }));

// === 等待 Coze 回复 ===
async function pollConversation(conversationId) {
  console.log('[POLL START] using conversationId =', conversationId);
  const maxTries = 20;
  const delay = 1000;

  for (let i = 0; i < maxTries; i++) {
    const resp = await fetch(`${COZE_API_HOST}/v1/conversation/message/list`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ conversation_id: conversationId }),
    });
    const data = await resp.json().catch(() => ({}));
    console.log(`[POLL ${i}]`, JSON.stringify(data).slice(0, 300));

    if (Array.isArray(data.data)) {
      const msg = data.data.find(m => m.role === 'assistant');
      if (msg && msg.content) return msg.content;
    }
    await new Promise(r => setTimeout(r, delay));
  }
  return '（等待超时或未识别到assistant回复）';
}

// === 主接口 ===
app.post('/api/chat', async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  try {
    const createResp = await fetch(`${COZE_API_HOST}/v3/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bot_id: COZE_BOT_ID,
        user_id: 'wx_user_001',
        additional_messages: [{ role: 'user', content: message, content_type: 'text' }],
        stream: false
      })
    });

    const createData = await createResp.json().catch(() => ({}));
    console.log('[CREATE RAW]', JSON.stringify(createData).slice(0, 800));

    // 国内 coze.cn 返回通常用 data.id
    const conversationId =
      createData?.data?.conversation_id ||
      createData?.data?.id ||
      createData?.conversation_id ||
      createData?.id;

    console.log('[CHOSEN conversationId =]', conversationId);

    if (!conversationId) {
      return res.json({ answer: '（未找到有效 conversation_id）' });
    }

    const answer = await pollConversation(conversationId);
    return res.json({ answer });
  } catch (err) {
    console.error('Coze proxy error:', err);
    return res.status(500).json({ error: 'Coze API failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server listening on port ${PORT}`));
