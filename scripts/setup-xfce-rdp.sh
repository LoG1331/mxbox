#!/bin/bash
# Deploy XFCE + xRDP + Google Chrome on Ubuntu Headless
# Usage: sudo bash setup-xfce-rdp.sh

set -e

echo "=============================="
echo " XFCE + xRDP + Chrome Setup"
echo "=============================="

# --- Kiểm tra chạy với sudo ---
if [ "$EUID" -ne 0 ]; then
  echo "❌ Chạy lại với sudo: sudo bash $0"
  exit 1
fi

REALUSER="${SUDO_USER:-$USER}"
USERHOME=$(eval echo "~$REALUSER")

echo "👤 User: $REALUSER"
echo "🏠 Home: $USERHOME"
echo ""

# --- 1. Update hệ thống ---
echo "[1/7] Updating system..."
apt update -y && apt upgrade -y

# --- 2. Cài XFCE + xRDP + dbus ---
echo "[2/7] Installing XFCE, xRDP, dbus..."
apt install -y \
  xfce4 \
  xfce4-goodies \
  xrdp \
  dbus-x11 \
  x11-xserver-utils \
  wget \
  curl \
  apt-transport-https \
  ca-certificates \
  gnupg

# --- 3. Cài Google Chrome ---
echo "[3/7] Installing Google Chrome..."
wget -q -O /tmp/google-chrome.deb \
  https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb

apt install -y /tmp/google-chrome.deb || true
apt --fix-broken install -y

rm -f /tmp/google-chrome.deb

# Kiểm tra cài thành công
if command -v google-chrome &> /dev/null; then
  echo "✅ Google Chrome $(google-chrome --version) đã cài xong"
else
  echo "❌ Chrome cài thất bại, kiểm tra lại kết nối mạng"
  exit 1
fi

# --- 4. Cấu hình startwm.sh ---
echo "[4/7] Configuring xRDP startwm.sh..."
cat > /etc/xrdp/startwm.sh << 'EOF'
#!/bin/sh
unset DBUS_SESSION_BUS_ADDRESS
unset XDG_RUNTIME_DIR
export $(dbus-launch)
exec startxfce4
EOF
chmod +x /etc/xrdp/startwm.sh

# --- 5. Cấu hình .xsession cho user ---
echo "[5/7] Configuring .xsession for $REALUSER..."
cat > "$USERHOME/.xsession" << 'EOF'
#!/bin/sh
unset DBUS_SESSION_BUS_ADDRESS
unset XDG_RUNTIME_DIR
export $(dbus-launch)
exec startxfce4
EOF
chmod +x "$USERHOME/.xsession"
chown "$REALUSER:$REALUSER" "$USERHOME/.xsession"

# --- 6. Fix SSL cert cho xRDP ---
echo "[6/7] Adding xrdp to ssl-cert group..."
usermod -aG ssl-cert xrdp

# --- 7. Enable + restart xRDP ---
echo "[7/7] Enabling and starting xRDP..."
systemctl enable xrdp
systemctl restart xrdp

# --- Mở firewall nếu UFW đang chạy ---
if systemctl is-active --quiet ufw; then
  echo "🔥 UFW detected — opening port 3389..."
  ufw allow 3389/tcp
  ufw reload
fi

# --- Done ---
echo ""
echo "=============================="
echo "✅ Setup hoàn tất!"
echo "=============================="
echo ""
echo "Kết nối RDP:"
echo "  Host : $(hostname -I | awk '{print $1}'):3389"
echo "  User : $REALUSER"
echo "  Pass : (mật khẩu Linux của $REALUSER)"
echo ""
echo "Windows: Win+R → mstsc → nhập IP trên"
echo ""
echo "💡 Lưu ý Chrome:"
echo "  - Lần đầu mở Chrome trong RDP, thêm flag --no-sandbox nếu chạy với root"
echo "  - Hoặc tạo alias: alias chrome='google-chrome --no-sandbox'"
echo ""
