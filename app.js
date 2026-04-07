// State & Constants
let hfApiKey = localStorage.getItem('hf_api_key') || '';
let hfChatHistory = [];
const HF_MODEL = 'openai/gpt-oss-120b';
const HF_API_BASE = 'https://router.huggingface.co/v1/chat/completions';
const FLUX_MODEL = 'black-forest-labs/FLUX.1-schnell';
const FLUX_API_URL = `https://router.huggingface.co/hf-inference/models/${FLUX_MODEL}`;

// Supabase State
let supabaseClient = null;
let chatSessionId = localStorage.getItem('hf_chat_session_id');
if (!chatSessionId) {
    chatSessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('hf_chat_session_id', chatSessionId);
}

// DOM Elements
const hfApiKeyInput = document.getElementById('hf-api-key');
const saveHfKeyBtn = document.getElementById('save-hf-key');
const navItems = document.querySelectorAll('.nav-item');
const viewContainers = document.querySelectorAll('.view-container');

const hfMessages = document.getElementById('hf-messages');
const hfUserInput = document.getElementById('hf-user-input');
const hfSendBtn = document.getElementById('hf-send-btn');
const clearHfChatBtn = document.getElementById('clear-hf-chat');

const imgPrompt = document.getElementById('img-prompt');
const imgSteps = document.getElementById('img-steps');
const imgSeed = document.getElementById('img-seed');
const imgGenerateBtn = document.getElementById('img-generate-btn');
const imgOutput = document.getElementById('img-output');
const imgActions = document.getElementById('img-actions');
const imgDownload = document.getElementById('img-download');

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    if (hfApiKey) {
        hfApiKeyInput.value = hfApiKey;
    }

    if (window.marked) {
        marked.setOptions({
            breaks: true,
            gfm: true
        });
    }

    // Auto-resize chat textarea
    hfUserInput.addEventListener('input', function() {
        this.style.height = '44px'; // Reset
        const newHeight = Math.min(this.scrollHeight, 200);
        this.style.height = newHeight + 'px';
    });

    // Load Supabase
    try {
        const envRes = await fetch('.env');
        if (envRes.ok) {
            const envText = await envRes.text();
            let url = '', key = '';
            envText.split('\n').forEach(line => {
                const match = line.match(/^\s*(SUPABASE_URL|SUPABASE_ANON_KEY)\s*=\s*(.*)$/);
                if (match) {
                    if (match[1] === 'SUPABASE_URL') url = match[2].trim();
                    if (match[1] === 'SUPABASE_ANON_KEY') key = match[2].trim();
                }
            });
            if (url && key && window.supabase) {
                supabaseClient = window.supabase.createClient(url, key);
                console.log('Supabase client initialized');
            }
        }
    } catch (e) {
        console.warn('Could not load .env file for Supabase. Make sure you are serving via a local web server.', e);
    }
});

// Toast Notifications System
const toastContainer = document.createElement('div');
toastContainer.className = 'toast-container';
document.body.appendChild(toastContainer);

function showNotification(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        toast.addEventListener('animationend', () => {
            toast.remove();
        });
    }, 3000);
}

async function saveToSupabase(role, content) {
    if (!supabaseClient) return;
    try {
        await supabaseClient.from('chat_messages').insert([{
            session_id: chatSessionId,
            role: role,
            content: content
        }]);
    } catch (err) {
        console.error('Error saving to Supabase:', err);
    }
}

// Sidebar Navigation Logic
navItems.forEach(item => {
    item.addEventListener('click', () => {
        // Update active class on nav
        navItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');

        // Show/hide views
        const targetId = item.getAttribute('data-target');
        viewContainers.forEach(view => {
            if (view.id === targetId) {
                view.classList.remove('hidden');
                // Small delay to ensure display:block applies before animation
                setTimeout(() => view.classList.add('active'), 10);
            } else {
                view.classList.add('hidden');
                view.classList.remove('active');
            }
        });
    });
});

// HF Key Save
saveHfKeyBtn.addEventListener('click', () => {
    const key = hfApiKeyInput.value.trim();
    if (key) {
        hfApiKey = key;
        localStorage.setItem('hf_api_key', key);
        showNotification('HF API Key saved successfully!', 'success');
    } else {
        showNotification('Please enter a valid API key', 'error');
    }
});

// GPT-OSS-120B Chat Logic
function addMessageToUI(content, role) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    if (role === 'assistant') {
        contentDiv.innerHTML = marked.parse(content);
        // Apply Prism syntax highlighting
        contentDiv.querySelectorAll('pre code').forEach((block) => {
            Prism.highlightElement(block);
        });
    } else {
        const p = document.createElement('p');
        p.textContent = content;
        contentDiv.appendChild(p);
    }
    
    msgDiv.appendChild(contentDiv);
    hfMessages.appendChild(msgDiv);
    hfMessages.scrollTop = hfMessages.scrollHeight;
}

function showTypingIndicator() {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant typing-indicator-msg';
    msgDiv.id = 'typing-indicator';
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    const typingSpan = document.createElement('div');
    typingSpan.className = 'typing';
    typingSpan.innerHTML = '<span></span><span></span><span></span>';
    contentDiv.appendChild(typingSpan);
    msgDiv.appendChild(contentDiv);
    hfMessages.appendChild(msgDiv);
    hfMessages.scrollTop = hfMessages.scrollHeight;
}

function removeTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) {
        indicator.remove();
    }
}

async function callHfApi(history) {
    const response = await fetch(HF_API_BASE, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${hfApiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: HF_MODEL,
            messages: [{ role: 'system', content: 'You are a helpful, brilliant AI assistant called GPT-OSS 120B. Answer concisely and use markdown formatting.' }, ...history],
            max_tokens: 2048,
            temperature: 0.7,
            stream: false
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

async function sendHfMessage() {
    const text = hfUserInput.value.trim();
    if (!text) return;
    
    if (!hfApiKey) {
        showNotification('Please save your Hugging Face API token first.', 'error');
        return;
    }

    // Reset input
    hfUserInput.value = '';
    hfUserInput.style.height = '44px';
    
    // UI Update
    addMessageToUI(text, 'user');
    hfChatHistory.push({ role: 'user', content: text });
    saveToSupabase('user', text);
    
    showTypingIndicator();
    hfSendBtn.disabled = true;

    try {
        const reply = await callHfApi(hfChatHistory);
        removeTypingIndicator();
        addMessageToUI(reply, 'assistant');
        hfChatHistory.push({ role: 'assistant', content: reply });
        saveToSupabase('assistant', reply);
    } catch (error) {
        removeTypingIndicator();
        addMessageToUI(`❌ Error: ${error.message}`, 'assistant');
        showNotification(error.message, 'error');
    } finally {
        hfSendBtn.disabled = false;
        hfUserInput.focus();
    }
}

hfUserInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendHfMessage();
    }
});

hfSendBtn.addEventListener('click', sendHfMessage);

clearHfChatBtn.addEventListener('click', () => {
    hfChatHistory = [];
    hfMessages.innerHTML = '';
    addMessageToUI('🗑️ Chat cleared!', 'assistant');
});

// FLUX.1-schnell Image Generation Logic
function setImgLoading(isLoading) {
    if (isLoading) {
        imgGenerateBtn.disabled = true;
        imgGenerateBtn.innerHTML = '<div class="btn-spinner"></div> Generating...';
        imgOutput.innerHTML = '<div class="flux-loader"><div class="flux-bar"></div><div class="flux-bar"></div><div class="flux-bar"></div><div class="flux-bar"></div></div>';
        imgOutput.className = 'img-output-placeholder';
        imgActions.classList.add('hidden');
    } else {
        imgGenerateBtn.disabled = false;
        imgGenerateBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Generate Image';
    }
}

async function generateImage() {
    const prompt = imgPrompt.value.trim();
    if (!prompt) {
        showNotification('Please enter an image prompt.', 'error');
        return;
    }

    if (!hfApiKey) {
        showNotification('Please save your Hugging Face API token first.', 'error');
        return;
    }

    const steps = imgSteps.value;
    const seed = imgSeed.value;

    setImgLoading(true);

    const body = {
        inputs: prompt,
        parameters: {
            num_inference_steps: parseInt(steps)
        }
    };

    if (seed) {
        body.parameters.seed = parseInt(seed);
    }

    try {
        const response = await fetch(FLUX_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${hfApiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'image/png'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            let errorMsg = `API Error: ${response.status} ${response.statusText}`;
            try {
                const errorData = await response.json();
                errorMsg = errorData.error || errorMsg;
            } catch (e) { } // If not JSON, use default
            throw new Error(errorMsg);
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);

        imgOutput.innerHTML = '';
        imgOutput.className = 'img-output-result';
        
        const img = document.createElement('img');
        img.className = 'generated-image';
        img.src = objectUrl;
        imgOutput.appendChild(img);

        imgDownload.href = objectUrl;
        imgDownload.download = `flux-${Date.now()}.png`;
        imgActions.classList.remove('hidden');

        showNotification('Image generated! 🎨', 'success');

    } catch (error) {
        imgOutput.innerHTML = `<p style="color: #ef4444; text-align: center;">❌ ${error.message}</p>`;
        imgOutput.className = 'img-output-placeholder';
        showNotification(error.message, 'error');
    } finally {
        setImgLoading(false);
    }
}

imgGenerateBtn.addEventListener('click', generateImage);

imgPrompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        generateImage();
    }
});
