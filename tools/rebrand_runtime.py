from pathlib import Path

root = Path('/home/ubuntu/dzhoot-live')
replacements = {
    'server/backend/src/templates/email/base.html': {
        'FireVision IPTV': 'DZ HOOF',
        'FireVision': 'DZ HOOF',
    },
    'server/backend/src/templates/email/verification.html': {
        'FireVision IPTV': 'DZ HOOF',
        'FireVision': 'DZ HOOF',
    },
    'server/backend/src/templates/email/welcome.html': {
        'FireVision IPTV': 'DZ HOOF',
        'FireVision': 'DZ HOOF',
    },
    'server/backend/src/services/email.ts': {
        'noreply@firevision.local': 'noreply@dzhoof.local',
        'Welcome to FireVision IPTV': 'Welcome to DZ HOOF',
        'Verify your email - FireVision IPTV': 'Verify your email - DZ HOOF',
        'Reset your password - FireVision IPTV': 'Reset your password - DZ HOOF',
    },
    'server/backend/src/services/epg-service.ts': {
        "'FireVision IPTV/1.0'": "'DZ-HOOF/1.0'",
        'FireVision IPTV': 'DZ HOOF',
    },
    'server/backend/src/routes/oauth.js': {
        "'FireVision-IPTV'": "'DZ-HOOF'",
    },
    'server/backend/src/utils/initSuperAdmin.ts': {
        'admin@firevision.local': 'admin@dzhoof.local',
    },
    'server/backend/src/utils/initTestUser.ts': {
        'testuser@firevision.local': 'testuser@dzhoof.local',
    },
    'server/backend/src/services/subscription-service.ts': {
        'firevision:device-lock:': 'dzhoof:device-lock:',
    },
    'server/backend/src/scheduler-entrypoint.ts': {
        'mongodb://localhost:27017/firevision-iptv': 'mongodb://localhost:27017/dzhoof-iptv',
    },
    'server/frontend/src/store/auth-store.ts': {
        "'firevision-auth'": "'dzhoof-auth'",
    },
    'server/frontend/src/store/ui-store.ts': {
        "'firevision-ui'": "'dzhoof-ui'",
    },
    'server/frontend/public/llms.txt': {
        'FireVision IPTV': 'DZ HOOF IPTV',
        'FireVisionIPTVServer': 'dzhoot',
        'FireVisionIPTV': 'dzhoot',
        'https://github.com/akshaynikhare/FireVisionIPTV/releases/latest': 'https://github.com/merci1994dz/dzhoot/releases/latest',
        'https://github.com/akshaynikhare/FireVisionIPTVServer': 'https://github.com/merci1994dz/dzhoot',
        'https://github.com/akshaynikhare/FireVisionIPTV': 'https://github.com/merci1994dz/dzhoot',
    },
}

for relative, changes in replacements.items():
    path = root / relative
    text = path.read_text()
    updated = text
    for old, new in changes.items():
        updated = updated.replace(old, new)
    if updated != text:
        path.write_text(updated)
        print(f'updated {relative}')

for path in sorted((root / 'server/backend/src/scripts/migrations').glob('*.ts')):
    text = path.read_text()
    updated = text.replace('mongodb://localhost:27017/firevision-iptv', 'mongodb://localhost:27017/dzhoof-iptv')
    if updated != text:
        path.write_text(updated)
        print(f'updated {path.relative_to(root)}')
