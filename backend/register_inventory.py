"""LabGear File 117 — safely mount the File 116 inventory router.

Run ONCE from the LabGear/backend directory:
    python LabGear_File_117_register_inventory.py

This changes ONLY app/main.py, preserving the currently installed FastAPI
middleware, security headers, CORS, health route and all existing routers.
It does not change the database or overwrite app/main.py with an older version.
"""

from __future__ import annotations

import ast
import os
from pathlib import Path
import tempfile

MAIN = Path('app/main.py')
ROUTER_FILE = Path('app/api/routes/equipment_management.py')
IMPORT_LINE = (
    'from app.api.routes.equipment_management import router as '
    'equipment_management_router'
)
MOUNT_LINE = 'app.include_router(equipment_management_router)'
IMPORT_ANCHOR = (
    'from app.api.routes.equipment import router as equipment_router'
)
MOUNT_ANCHOR = 'app.include_router(equipment_router)'


def fail(message: str) -> None:
    raise SystemExit(f'File 117 STOP: {message}\nNo changes were made.')


def run() -> None:
    if not MAIN.is_file():
        fail('Run this command from the LabGear/backend directory; app/main.py not found.')
    if not ROUTER_FILE.is_file():
        fail('File 116 is missing from app/api/routes/equipment_management.py.')

    original = MAIN.read_bytes()
    bom = b'\xef\xbb\xbf' if original.startswith(b'\xef\xbb\xbf') else b''
    try:
        source = original[len(bom):].decode('utf-8')
    except UnicodeDecodeError:
        fail('app/main.py must be UTF-8 encoded.')

    newline = '\r\n' if '\r\n' in source else '\n'
    try:
        ast.parse(source, filename=str(MAIN))
    except SyntaxError:
        fail('The existing app/main.py has a syntax error; no changes applied.')

    lines = source.splitlines(keepends=True)
    stripped = [line.strip() for line in lines]
    has_import = IMPORT_LINE in stripped
    has_mount = MOUNT_LINE in stripped
    if has_import and has_mount:
        print('File 117 ALREADY INSTALLED: existing router registration preserved.')
        return
    if has_import or has_mount:
        fail('Partial inventory router registration exists; inspect app/main.py manually.')

    import_positions = [i for i, line in enumerate(stripped) if line == IMPORT_ANCHOR]
    mount_positions = [i for i, line in enumerate(stripped) if line == MOUNT_ANCHOR]
    if len(import_positions) != 1 or len(mount_positions) != 1:
        fail('Expected one existing equipment router import and one include_router call. '
             'Upload your current app/main.py to integrate safely.')

    insertions = [
        (import_positions[0], IMPORT_LINE),
        (mount_positions[0], MOUNT_LINE),
    ]
    # Reverse index order so inserting either line cannot shift the other anchor.
    for idx, value in sorted(insertions, reverse=True):
        if not lines[idx].endswith(('\n', '\r')):
            lines[idx] += newline
        lines.insert(idx + 1, value + newline)

    updated = ''.join(lines)
    try:
        tree = ast.parse(updated, filename=str(MAIN))
    except SyntaxError:
        fail('Updated code would not compile; original app/main.py was preserved.')

    # Confirm the new import and include_router are at module scope.
    import_ok = any(
        isinstance(node, ast.ImportFrom)
        and node.module == 'app.api.routes.equipment_management'
        and any(alias.name == 'router' and alias.asname == 'equipment_management_router'
                for alias in node.names)
        for node in tree.body
    )
    mount_ok = any(
        isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Attribute)
        and isinstance(node.value.func.value, ast.Name)
        and node.value.func.value.id == 'app'
        and node.value.func.attr == 'include_router'
        and node.value.args
        and isinstance(node.value.args[0], ast.Name)
        and node.value.args[0].id == 'equipment_management_router'
        for node in tree.body
    )
    if not import_ok or not mount_ok:
        fail('Router registration was not module-scoped; original file preserved.')

    # Atomic replacement; the temporary file is removed on any error.
    temp_name = None
    try:
        fd, temp_name = tempfile.mkstemp(prefix='.main_file117_', suffix='.tmp', dir=MAIN.parent)
        with os.fdopen(fd, 'wb') as output:
            output.write(bom + updated.encode('utf-8'))
        os.replace(temp_name, MAIN)
        temp_name = None
    finally:
        if temp_name is not None:
            Path(temp_name).unlink(missing_ok=True)

    print('File 117 INSTALLED: app/main.py updated successfully.')
    print('Preserved all existing router registrations, middleware and other code.')
    print('Added import and app.include_router for five inventory endpoints.')


if __name__ == '__main__':
    run()
