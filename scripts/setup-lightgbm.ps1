$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$cache = Join-Path $root 'node_modules/.cache/lightgbm'
[System.IO.Directory]::CreateDirectory($cache) | Out-Null
$uvFolder = Join-Path $cache 'uv'
$uv = Join-Path $uvFolder 'uv.exe'
if (-not (Test-Path $uv)) {
    $archive = Join-Path $cache 'uv.zip'
    Invoke-WebRequest 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' -OutFile $archive
    Expand-Archive $archive -DestinationPath $uvFolder -Force
}
$env:UV_PYTHON_INSTALL_DIR = Join-Path $cache 'python'
& $uv python install 3.12
if ($LASTEXITCODE -ne 0) { throw 'Python installation failed.' }
$venv = Join-Path $cache 'venv'
$python = Join-Path $venv 'Scripts/python.exe'
if (-not (Test-Path $python)) {
    & $uv venv --python 3.12 $venv
    if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
}
& $uv pip install --python $python -r (Join-Path $PSScriptRoot 'lightgbm-requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'LightGBM dependency installation failed.' }
& $python -c "import lightgbm; print('LightGBM ready:', lightgbm.__version__)"