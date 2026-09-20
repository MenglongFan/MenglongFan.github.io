// 三国杀国战积分系统 · 认证上下文 + 弹窗系统

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { api, setHouseKey, clearHouseKey, API_ENDPOINTS } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [toast, setToast] = useState(null); // { msg, type }
  const [modal, setModal] = useState(null); // { title, body, footer } or null
  const toastTimer = useRef(null);

  // showToast(msg, type)
  const showToast = useCallback((msg, type = '') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // setModal(title, bodyNode, footerNode)
  const setModalContent = useCallback((title, body, footer = null) => {
    setModal({ title, body, footer });
  }, []);

  // closeModal()
  const closeModal = useCallback(() => {
    setModal(null);
  }, []);

  // confirmAction(message, onConfirm)
  const confirmAction = useCallback((message, onConfirm) => {
    setModal({
      title: '确认操作',
      body: (
        <div style={{ padding: '8px 4px 4px', fontSize: '15px', lineHeight: '1.7', color: 'var(--paper)' }}>
          {message}
        </div>
      ),
      footer: (
        <>
          <button className="btn btn-ghost" onClick={() => setModal(null)}>取消</button>
          <button className="btn btn-primary" onClick={() => { setModal(null); onConfirm(); }}>确定</button>
        </>
      ),
    });
  }, []);

  // authStep(title, onSuccess, onError)
  // 显示密码输入弹窗，验证通过后调用 onSuccess
  const authStep = useCallback((title, onSuccess, onError) => {
    let keyInput = '';
    setModal({
      title,
      body: (
        <div className="form-group">
          <label className="form-label">房主密码</label>
          <input
            type="password"
            className="form-input"
            placeholder="输入房主密码"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                keyInput = e.target.value;
                document.getElementById('auth-confirm-btn')?.click();
              }
            }}
            onChange={(e) => { keyInput = e.target.value; }}
          />
        </div>
      ),
      footer: (
        <>
          <button className="btn btn-ghost" onClick={() => setModal(null)}>取消</button>
          <button
            className="btn btn-primary"
            id="auth-confirm-btn"
            onClick={async () => {
              setHouseKey(keyInput);
              try {
                await api(API_ENDPOINTS.AUTH, { method: 'POST', auth: true });
                setModal(null);
                onSuccess();
              } catch {
                showToast('密码错误', 'error');
                clearHouseKey();
                if (onError) onError();
              }
            }}
          >
            确认
          </button>
        </>
      ),
    });
  }, [showToast]);

  // 清理 toast 定时器
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const value = {
    authStep,
    confirmAction,
    showToast,
    setModalContent,
    closeModal,
    modal,
    toast,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      {/* Toast 渲染 */}
      {toast && (
        <div className={`toast show ${toast.type}`}>
          {toast.msg}
        </div>
      )}
      {/* Modal 渲染 */}
      {modal && (
        <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">{modal.title}</span>
              <button className="modal-close" onClick={() => setModal(null)}>&times;</button>
            </div>
            <div className="modal-body">
              {modal.body}
            </div>
            {modal.footer && (
              <div className="modal-footer">
                {modal.footer}
              </div>
            )}
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
