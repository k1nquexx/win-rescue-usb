import React, { useState, useEffect, useMemo } from 'react';
import defaultBranding from './data/branding.json';
import {
  WIZARD_STEPS,
  WINDOWS_PROFILES,
  WINDOWS_THEMES,
  CATALOG_CATEGORIES,
  CATALOG_ITEMS,
  USER_SETTINGS_OPTIONS,
  FALLBACK_DISKS,
} from './data/catalog';
import { buildGeneratedFiles } from './utils/generators';
import {
  Check,
  HardDrive,
  Usb,
  RefreshCw,
  Search,
  Sparkles,
  ShieldCheck,
  Cpu,
  Download,
  FolderOpen,
  Play,
  Layers,
} from 'lucide-react';

export default function App() {
  const [currentStep, setCurrentStep] = useState(1);

  // Branding & Order (Section 4.1 & [BUG-08])
  const [brandName, setBrandName] = useState(defaultBranding.brandName || 'Fosters PC');
  const [tagline, setTagline] = useState(defaultBranding.tagline || 'GAME RELIGION');
  const [orderNumber, setOrderNumber] = useState('');

  // Step 2: Version & Theme
  const [profileId, setProfileId] = useState('gaming');
  const [themeId, setThemeId] = useState('win11');
  const [colorMode, setColorMode] = useState('dark'); // 'dark' | 'light'

  // Step 3: Disks
  const [disks, setDisks] = useState(FALLBACK_DISKS);
  const [selectedDiskNumber, setSelectedDiskNumber] = useState(0);
  const [selectedPartitionId, setSelectedPartitionId] = useState(3);
  const [loadingDisks, setLoadingDisks] = useState(false);
  const [showPartitionModal, setShowPartitionModal] = useState(false);

  // Step 4: Catalog (Programs, Drivers, Tweaks, RGB)
  const [activeCategory, setActiveCategory] = useState('programs');
  const [searchQuery, setSearchQuery] = useState('');
  const [catalogPage, setCatalogPage] = useState(1);
  const [cpuVendorMode, setCpuVendorMode] = useState('auto'); // 'auto' | 'amd' | 'intel'

  const defaultSelectedIds = useMemo(() => {
    const all = [
      ...CATALOG_ITEMS.programs,
      ...CATALOG_ITEMS.drivers,
      ...CATALOG_ITEMS.tweaks,
      ...CATALOG_ITEMS.rgb,
    ];
    return all.filter((i) => i.defaultSelected).map((i) => i.id);
  }, []);

  const [selectedItems, setSelectedItems] = useState(defaultSelectedIds);
  const [focusedItemId, setFocusedItemId] = useState('chrome');

  // Step 5: User Settings
  const [username, setUsername] = useState(defaultBranding.defaultUsername || 'Fosters');
  const [selectedUserSettings, setSelectedUserSettings] = useState(() =>
    USER_SETTINGS_OPTIONS.filter((o) => o.defaultChecked).map((o) => o.id)
  );
  const [settingsPage, setSettingsPage] = useState(1);

  // Step 6: Review & Code Preview
  const [activeCodeTab, setActiveCodeTab] = useState('summary'); // 'summary' | 'unattend' | 'postps1' | 'diskpart'
  const [exportStatus, setExportStatus] = useState(null);

  // Step 7: Installation Simulation & Live Post-Install Preview
  const [installPhase, setInstallPhase] = useState('firstlogon'); // 'winpe' | 'firstlogon'
  const [installProgress, setInstallProgress] = useState(0);
  const [installSubStatus, setInstallSubStatus] = useState('Подготавливаем профиль Windows');

  // Sync Electron window title with brandName (Section 4.1)
  useEffect(() => {
    const effectiveBrand = brandName.trim() || defaultBranding.brandName || 'Fosters PC';
    window.rescueApi?.setWindowTitle?.(effectiveBrand);
  }, [brandName]);

  // [BUG-02] Load real physical disks and default to the first non-USB drive
  const refreshDisks = async () => {
    setLoadingDisks(true);
    try {
      if (window.rescueApi?.getDisks) {
        const res = await window.rescueApi.getDisks();
        if (res?.ok && Array.isArray(res.disks) && res.disks.length > 0) {
          setDisks(res.disks);
          const firstInternal = res.disks.find((d) => !d.isUsb) || res.disks[0];
          setSelectedDiskNumber(firstInternal.number);
        }
      }
    } catch (_err) {
      // Fallback disks remain active
    } finally {
      setTimeout(() => setLoadingDisks(false), 300);
    }
  };

  useEffect(() => {
    refreshDisks();
  }, []);

  // Auto-advance progress bar when on Step 7
  useEffect(() => {
    if (currentStep !== 7) return;
    setInstallProgress(12);
    const messages = [
      'Удаляем только перечисленные потребительские приложения Microsoft. Xbox, безопасность и Windows Update сохраняются.',
      'Настраиваем схему электропитания «Высокая производительность» и отключаем парковку ядер ЦП...',
      'Применяем игровые твики реестра (MSI Mode, HAGS, отключение VBS и телеметрии)...',
      'Применяем выбранную тему оформления, обои и параметры Проводника Windows 11...',
      'Устанавливаем выбранные программы и библиотеки Visual C++ / DirectX (Offline USB + Winget)...',
    ];
    const timer = setInterval(() => {
      setInstallProgress((prev) => {
        const next = Math.min(100, prev + 8);
        const msgIdx = Math.min(messages.length - 1, Math.floor((next / 100) * messages.length));
        setInstallSubStatus(messages[msgIdx]);
        return next;
      });
    }, 650);
    return () => clearInterval(timer);
  }, [currentStep, installPhase]);

  const effectiveBrandName = brandName.trim() || defaultBranding.brandName || 'Fosters PC';

  // Config bundle for generators
  const fullConfig = useMemo(
    () => ({
      brandName: effectiveBrandName,
      orderNumber,
      profileId,
      themeId,
      colorMode,
      selectedDiskNumber,
      selectedItems,
      cpuVendorMode,
      username,
      selectedUserSettings,
    }),
    [
      effectiveBrandName,
      orderNumber,
      profileId,
      themeId,
      colorMode,
      selectedDiskNumber,
      selectedItems,
      cpuVendorMode,
      username,
      selectedUserSettings,
    ]
  );

  // [PERF-02] Only compute preview strings on steps that display them (Steps 3, 6, 8)
  const shouldComputePreview = currentStep === 3 || currentStep === 6 || currentStep === 8;
  const generatedFiles = useMemo(() => {
    if (!shouldComputePreview) return null;
    return buildGeneratedFiles(fullConfig);
  }, [fullConfig, shouldComputePreview]);

  // [BUG-03] & [ERR-04] Async export with cancel handling and boolean return status
  const handleExportBundle = async (askFolder = false) => {
    try {
      const filesToExport = generatedFiles || buildGeneratedFiles(fullConfig);
      if (window.rescueApi?.exportUsbBundle) {
        const res = await window.rescueApi.exportUsbBundle({
          askFolder,
          ...filesToExport,
        });
        if (res?.canceled) {
          return false;
        }
        if (res?.ok) {
          setExportStatus({ ok: true, path: res.targetDir });
          return true;
        }
        setExportStatus({ ok: false, error: res?.error || 'Ошибка экспорта' });
        return false;
      } else {
        // Browser fallback: download post-install-tweaks.ps1
        const blob = new Blob([filesToExport.postInstallScript], {
          type: 'text/plain;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'post-install-tweaks.ps1';
        a.click();
        URL.revokeObjectURL(url);
        setExportStatus({ ok: true, path: 'Скачано через браузер (post-install-tweaks.ps1)' });
        return true;
      }
    } catch (err) {
      setExportStatus({ ok: false, error: String(err?.message || err) });
      return false;
    }
  };

  const toggleCatalogItem = (id) => {
    setSelectedItems((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleUserSetting = (id) => {
    setSelectedUserSettings((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Filtered catalog items for Step 4
  const categoryList = CATALOG_ITEMS[activeCategory] || [];
  const filteredCatalog = categoryList.filter(
    (item) =>
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.shortDesc.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const ITEMS_PER_PAGE = 4;
  const totalCatalogPages = Math.max(1, Math.ceil(filteredCatalog.length / ITEMS_PER_PAGE));
  const safeCatalogPage = Math.min(catalogPage, totalCatalogPages);
  const visibleCatalogItems = filteredCatalog.slice(
    (safeCatalogPage - 1) * ITEMS_PER_PAGE,
    safeCatalogPage * ITEMS_PER_PAGE
  );

  const allItemsFlat = useMemo(
    () => [
      ...CATALOG_ITEMS.programs,
      ...CATALOG_ITEMS.drivers,
      ...CATALOG_ITEMS.tweaks,
      ...CATALOG_ITEMS.rgb,
    ],
    []
  );
  const focusedItem =
    allItemsFlat.find((x) => x.id === focusedItemId) ||
    visibleCatalogItems[0] ||
    categoryList[0];

  const selectedInActiveCategoryCount = categoryList.filter((i) =>
    selectedItems.includes(i.id)
  ).length;

  // Step 5 pagination
  const SETTINGS_PER_PAGE = 4;
  const totalSettingsPages = Math.ceil(USER_SETTINGS_OPTIONS.length / SETTINGS_PER_PAGE);
  const visibleSettings = USER_SETTINGS_OPTIONS.slice(
    (settingsPage - 1) * SETTINGS_PER_PAGE,
    settingsPage * SETTINGS_PER_PAGE
  );

  const selectedDisk =
    disks.find((d) => d.number === selectedDiskNumber) ||
    disks.find((d) => !d.isUsb) ||
    disks[0] ||
    FALLBACK_DISKS[0];
  const selectedTheme =
    WINDOWS_THEMES.find((t) => t.id === themeId) || WINDOWS_THEMES[0];
  const selectedProfile =
    WINDOWS_PROFILES.find((p) => p.id === profileId) || WINDOWS_PROFILES[2];

  return (
    <div className="h-screen w-screen bg-[#0b1017] text-slate-100 flex flex-col select-none overflow-hidden">
      {/* TOP NAVIGATION HEADER */}
      <header className="h-20 border-b border-[#1b2634] bg-[#0d131c]/95 px-8 flex items-center justify-between shrink-0">
        {/* Brand Logo */}
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-[#00d4b6]/10 border border-[#00d4b6]/40 flex items-center justify-center shadow-[0_0_15px_rgba(0,212,182,0.2)]">
            <Layers className="w-6 h-6 text-[#00d4b6]" />
          </div>
          <div>
            <div className="text-lg font-black tracking-wider text-white uppercase leading-none">
              {effectiveBrandName}
            </div>
            <div className="text-[10px] font-bold tracking-[0.28em] text-[#00d4b6] uppercase mt-1">
              {tagline}
            </div>
          </div>
        </div>

        {/* 8 Wizard Steps */}
        <nav className="flex items-center gap-2 lg:gap-5">
          {WIZARD_STEPS.map((step) => {
            const isActive = currentStep === step.id;
            const isPassed = currentStep > step.id;
            return (
              <button
                key={step.id}
                onClick={() => setCurrentStep(step.id)}
                className={`group relative py-2 px-2.5 text-left transition-colors cursor-pointer ${
                  isActive
                    ? 'text-white'
                    : isPassed
                    ? 'text-slate-300 hover:text-white'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <div
                  className={`text-[11px] font-mono leading-none mb-1 ${
                    isActive
                      ? 'text-[#00d4b6] font-bold'
                      : isPassed
                      ? 'text-[#00d4b6]/70'
                      : 'text-slate-600'
                  }`}
                >
                  {step.num}
                </div>
                <div className="text-xs lg:text-sm font-semibold tracking-tight">
                  {step.label}
                </div>
                {isActive && (
                  <div className="absolute bottom-0 left-2 right-2 h-[3px] bg-[#00d4b6] rounded-full shadow-[0_0_12px_#00d4b6]" />
                )}
              </button>
            );
          })}
        </nav>
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 overflow-y-auto px-10 py-8 flex flex-col justify-between">
        {/* =====================================================================
            STEP 01: СТАРТ (0:04 - 0:07 in video)
           ===================================================================== */}
        {currentStep === 1 && (
          <div className="my-auto grid grid-cols-12 gap-8 items-center max-w-6xl mx-auto w-full">
            <div className="col-span-7 bg-[#111924] border border-[#1e2c3d] rounded-xl p-10 shadow-2xl relative overflow-hidden">
              <div className="absolute -top-24 -left-24 w-64 h-64 bg-[#00d4b6]/5 rounded-full blur-3xl pointer-events-none" />
              <div className="text-xs font-bold tracking-[0.2em] text-[#00d4b6] uppercase mb-3">
                WINDOWS 11 · {effectiveBrandName.toUpperCase()}
              </div>
              <h1 className="text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-tight mb-4">
                Добро пожаловать
                <br />в {effectiveBrandName}
              </h1>
              <p className="text-xl font-semibold text-slate-200 mb-2">
                Установим Windows вместе
              </p>
              <p className="text-sm text-slate-400 mb-8 max-w-lg leading-relaxed">
                Выберите Windows, программы и настройки. Перед установкой всё проверим и создадим
                автоматический сценарий развёртывания для загрузочной флешки.
              </p>

              <div className="flex items-center gap-4 mb-7">
                <button
                  onClick={() => setCurrentStep(2)}
                  className="px-8 py-4 rounded-lg bg-[#00d4b6] hover:bg-[#00e6c5] text-slate-950 font-bold text-base transition shadow-[0_0_25px_rgba(0,212,182,0.35)] cursor-pointer"
                >
                  Начать настройку
                </button>
                <button
                  onClick={() => window.rescueApi?.closeWindow?.()}
                  className="px-7 py-4 rounded-lg bg-[#16202d] hover:bg-[#1e2b3c] border border-[#263649] text-slate-300 font-semibold text-base transition cursor-pointer"
                >
                  Выход
                </button>
              </div>

              <div className="pt-5 border-t border-[#1c2838] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span className="text-xs text-slate-400">
                  Номер заказа — по желанию после первого входа
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Напр. #FPC-4090"
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    className="px-3 py-1.5 text-xs rounded bg-[#0c121a] border border-[#233244] text-slate-200 focus:outline-none focus:border-[#00d4b6]"
                  />
                  {/* [BUG-08] Allow clearing input while typing; restore default onBlur */}
                  <input
                    type="text"
                    placeholder="Бренд (Fosters PC)"
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    onBlur={() => {
                      if (!brandName.trim()) {
                        setBrandName(defaultBranding.brandName || 'Fosters PC');
                      }
                    }}
                    className="px-3 py-1.5 text-xs rounded bg-[#0c121a] border border-[#233244] text-slate-200 focus:outline-none focus:border-[#00d4b6] w-36"
                    title="Название вашего бренда в установщике"
                  />
                </div>
              </div>
            </div>

            {/* Right visual showcase card */}
            <div className="col-span-5 bg-gradient-to-br from-[#131d2a] to-[#0d141d] border border-[#1e2c3d] rounded-xl p-6 shadow-2xl flex flex-col justify-between h-full min-h-[420px] relative overflow-hidden">
              <div className="absolute -right-12 -bottom-12 w-72 h-72 bg-[#00d4b6]/10 rounded-full blur-3xl pointer-events-none" />
              <div className="flex items-center justify-between">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#00d4b6]/15 text-[#00d4b6] border border-[#00d4b6]/30">
                  {defaultBranding.usbVersion || 'Флешка-спаситель v2.5'}
                </span>
                <span className="text-xs text-slate-400 font-mono">WinPE 11 x64 + Offline/Winget</span>
              </div>

              {/* Stylized PC Case Illustration */}
              <div className="my-6 mx-auto w-full max-w-[290px] aspect-[4/3] rounded-xl bg-[#090d13] border border-[#223246] p-4 flex flex-col justify-between relative shadow-inner">
                <div className="flex items-center justify-between">
                  <div className="flex gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#00d4b6] animate-pulse" />
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-500/50" />
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">RTX / RYZEN READY</span>
                </div>
                <div className="grid grid-cols-3 gap-2 my-auto">
                  <div className="h-20 rounded-lg bg-gradient-to-b from-[#00d4b6]/20 to-transparent border border-[#00d4b6]/30 flex flex-col items-center justify-center p-2">
                    <Cpu className="w-6 h-6 text-[#00d4b6] mb-1" />
                    <span className="text-[10px] text-slate-300 font-semibold">3 Профиля</span>
                  </div>
                  <div className="h-20 rounded-lg bg-gradient-to-b from-cyan-500/20 to-transparent border border-cyan-500/30 flex flex-col items-center justify-center p-2">
                    <Sparkles className="w-6 h-6 text-cyan-400 mb-1" />
                    <span className="text-[10px] text-slate-300 font-semibold">FPS Твики</span>
                  </div>
                  <div className="h-20 rounded-lg bg-gradient-to-b from-indigo-500/20 to-transparent border border-indigo-500/30 flex flex-col items-center justify-center p-2">
                    <ShieldCheck className="w-6 h-6 text-indigo-400 mb-1" />
                    <span className="text-[10px] text-slate-300 font-semibold">Авто-Софт</span>
                  </div>
                </div>
                <div className="text-[11px] text-center text-slate-400 font-mono">
                  Обнаружено накопителей: {disks.length}
                </div>
              </div>

              <div className="text-xs text-slate-400 space-y-1.5 bg-[#0b1017]/80 p-3.5 rounded-lg border border-[#1a2533]">
                <div className="flex items-center justify-between">
                  <span>Выбранный профиль:</span>
                  <span className="text-[#00d4b6] font-semibold">
                    {selectedProfile.title.split('—')[0]}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Выбрано программ и твиков:</span>
                  <span className="text-slate-200 font-semibold">{selectedItems.length} шт.</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            STEP 02: ВЕРСИЯ И ОФОРМЛЕНИЕ WINDOWS (0:08 - 0:34 in video)
           ===================================================================== */}
        {currentStep === 2 && (
          <div className="max-w-6xl mx-auto w-full flex-1 flex flex-col justify-between">
            <div>
              <h2 className="text-3xl font-extrabold text-white tracking-tight">
                Версия и оформление Windows
              </h2>
              <p className="text-sm text-slate-400 mt-1 mb-6">
                Выберите подходящий профиль. Оформление можно поменять позже.
              </p>

              <div className="grid grid-cols-12 gap-8 items-start">
                {/* Left 6 cols: 3 Windows 11 Profiles */}
                <div className="col-span-6 space-y-3.5">
                  {WINDOWS_PROFILES.map((prof) => {
                    const active = profileId === prof.id;
                    return (
                      <div
                        key={prof.id}
                        onClick={() => setProfileId(prof.id)}
                        className={`p-5 rounded-xl border transition cursor-pointer flex items-center justify-between gap-4 ${
                          active
                            ? 'bg-[#0e292d] border-[#00d4b6] shadow-[0_0_25px_rgba(0,212,182,0.15)]'
                            : 'bg-[#111923] border-[#1f2d3d] hover:border-slate-600'
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2.5">
                            <span className="text-lg font-bold text-white">{prof.title}</span>
                          </div>
                          <p className="text-xs text-slate-300 leading-relaxed">{prof.subtitle}</p>
                          <div className="flex items-center gap-2 pt-1.5">
                            <span className="text-[11px] px-2 py-0.5 rounded bg-[#0b1118] text-[#00d4b6] border border-[#00d4b6]/30 font-mono">
                              {prof.ramUsage}
                            </span>
                            <span className="text-[11px] px-2 py-0.5 rounded bg-[#0b1118] text-slate-400 border border-slate-800 font-mono">
                              {prof.processes}
                            </span>
                          </div>
                        </div>

                        <div
                          className={`w-6 h-6 rounded flex items-center justify-center shrink-0 border ${
                            active
                              ? 'bg-[#00d4b6] border-[#00d4b6] text-slate-950'
                              : 'border-slate-600 bg-[#0c1219]'
                          }`}
                        >
                          {active && <Check className="w-4 h-4 stroke-[3]" />}
                        </div>
                      </div>
                    );
                  })}

                  <p className="text-xs text-slate-400 pt-2">
                    Оформление не меняет выбранную версию Windows.
                  </p>
                </div>

                {/* Right 6 cols: Themes (Win11, Win10 style, DOOM, Witcher, S.T.A.L.K.E.R.) & Color mode */}
                <div className="col-span-6 space-y-4">
                  {/* Top row: Windows 11 & Windows 10 Style */}
                  <div className="grid grid-cols-2 gap-3.5">
                    {WINDOWS_THEMES.slice(0, 2).map((theme) => {
                      const active = themeId === theme.id;
                      return (
                        <div
                          key={theme.id}
                          onClick={() => setThemeId(theme.id)}
                          className={`rounded-xl overflow-hidden border transition cursor-pointer ${
                            active
                              ? 'border-[#00d4b6] ring-2 ring-[#00d4b6]/30'
                              : 'border-[#1f2d3d] hover:border-slate-600'
                          }`}
                        >
                          <div
                            className={`h-24 bg-gradient-to-br ${theme.gradient} p-3 flex flex-col justify-between relative`}
                          >
                            <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-black/40 text-white w-fit">
                              {theme.tag}
                            </span>
                            <div className="text-xs text-white/80 font-mono">
                              {theme.id === 'win10'
                                ? 'Пуск слева · Классика'
                                : 'Пуск по центру · Bloom'}
                            </div>
                          </div>
                          <div className="bg-[#121b26] px-3.5 py-2.5 text-sm font-bold text-white flex items-center justify-between">
                            <span>{theme.title}</span>
                            {active && <span className="w-2 h-2 rounded-full bg-[#00d4b6]" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Second row: Gaming themes (DOOM, Ведьмак, S.T.A.L.K.E.R.) */}
                  <div className="grid grid-cols-3 gap-3">
                    {WINDOWS_THEMES.slice(2).map((theme) => {
                      const active = themeId === theme.id;
                      return (
                        <div
                          key={theme.id}
                          onClick={() => setThemeId(theme.id)}
                          className={`rounded-xl overflow-hidden border transition cursor-pointer ${
                            active
                              ? 'border-[#00d4b6] ring-2 ring-[#00d4b6]/30'
                              : 'border-[#1f2d3d] hover:border-slate-600'
                          }`}
                        >
                          <div
                            className={`h-20 bg-gradient-to-br ${theme.gradient} p-2.5 flex flex-col justify-between`}
                          >
                            <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-black/50 text-white w-fit">
                              GAME THEME
                            </span>
                          </div>
                          <div className="bg-[#121b26] px-3 py-2 text-xs font-bold text-white flex items-center justify-between">
                            <span>{theme.title}</span>
                            {active && <span className="w-2 h-2 rounded-full bg-[#00d4b6]" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Color Mode Toggle Button (Dark / Light) */}
                  <button
                    onClick={() => setColorMode((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                    className="w-full py-2.5 px-4 rounded-lg bg-[#141e2b] hover:bg-[#192535] border border-[#243447] text-xs font-semibold text-slate-200 transition cursor-pointer text-center"
                  >
                    Цвет оформления: {colorMode === 'dark' ? 'тёмный' : 'светлый'} (нажмите для смены)
                  </button>

                  {/* Theme caption box */}
                  <div className="p-3.5 rounded-lg bg-[#101722] border border-[#1c2838] text-xs text-slate-400 leading-relaxed">
                    {selectedTheme.subtitle}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer buttons */}
            <div className="flex items-center justify-between pt-6 border-t border-[#182230]">
              <button
                onClick={() => setCurrentStep(1)}
                className="px-7 py-3 rounded-lg bg-[#151f2c] hover:bg-[#1c293a] border border-[#253549] text-sm font-semibold text-slate-200 cursor-pointer"
              >
                Назад
              </button>
              <button
                onClick={() => setCurrentStep(3)}
                className="px-8 py-3 rounded-lg bg-[#00d4b6] hover:bg-[#00e6c5] text-slate-950 font-bold text-sm shadow-[0_0_20px_rgba(0,212,182,0.3)] cursor-pointer"
              >
                Далее
              </button>
            </div>
          </div>
        )}

        {/* =====================================================================
            STEP 03: ДИСК — КУДА УСТАНОВИТЬ WINDOWS? (0:35 - 0:38 in video)
           ===================================================================== */}
        {currentStep === 3 && (
          <div className="max-w-6xl mx-auto w-full flex-1 flex flex-col justify-between">
            <div>
              <h2 className="text-3xl font-extrabold text-white tracking-tight">
                Куда установить Windows?
              </h2>
              <p className="text-sm text-slate-400 mt-1 mb-6">
                Выберите накопитель слева. Справа показаны его разделы. Загрузочная USB-флешка
                автоматически защищена от случайного форматирования.
              </p>

              <div className="grid grid-cols-12 gap-8 items-start">
                {/* Left 5 cols: Disks list */}
                <div className="col-span-5 flex flex-col justify-between space-y-3">
                  {disks.map((d) => {
                    const active = d.number === selectedDisk.number && !d.isUsb;
                    return (
                      <div
                        key={d.number}
                        onClick={() => {
                          // [BUG-02] Prevent selecting the bootable USB drive for OS installation/wipe
                          if (d.isUsb) return;
                          setSelectedDiskNumber(d.number);
                          setSelectedPartitionId(3);
                        }}
                        className={`p-4 rounded-xl border transition ${
                          d.isUsb
                            ? 'bg-[#12161f]/80 border-rose-900/40 opacity-80 cursor-not-allowed'
                            : active
                            ? 'bg-[#0e292d] border-[#00d4b6] shadow-[0_0_20px_rgba(0,212,182,0.15)] cursor-pointer'
                            : 'bg-[#111923] border-[#1f2d3d] hover:border-slate-600 cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-white flex items-center gap-2">
                            {d.isUsb ? (
                              <Usb className="w-4 h-4 text-rose-400" />
                            ) : (
                              <HardDrive className="w-4 h-4 text-[#00d4b6]" />
                            )}
                            Диск {d.number} · {d.model}
                          </span>
                          {d.isUsb && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-700/50 font-bold">
                              ЗАЩИТА ФЛЕШКИ
                            </span>
                          )}
                        </div>
                        {/* [BUG-08] Accurate disk type label (Системный диск vs Чистый диск vs Флешка) */}
                        <div
                          className={`text-xs font-mono ${
                            d.isUsb
                              ? 'text-rose-400 font-semibold'
                              : d.isSystem
                              ? 'text-amber-300'
                              : 'text-[#00d4b6]'
                          }`}
                        >
                          {d.isUsb
                            ? `Флешка · ${d.busType} · ${d.sizeGb} ГБ · ${d.partitionStyle} (недоступна для стирания)`
                            : `${d.isSystem ? 'Системный диск' : 'Чистый диск'} · ${d.busType} · ${
                                d.sizeGb
                              } ГБ · ${d.partitionStyle}`}
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex items-center justify-between pt-4">
                    <button
                      onClick={refreshDisks}
                      className="px-4 py-2 rounded-lg bg-[#141e2b] hover:bg-[#1b2838] border border-[#243447] text-xs font-semibold text-slate-200 flex items-center gap-2 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingDisks ? 'animate-spin' : ''}`} />
                      Обновить
                    </button>
                    <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                      <span className="px-2.5 py-1 rounded bg-[#121a24] border border-[#1f2d3e]">
                        &lt;
                      </span>
                      <span>1 / 1</span>
                      <span className="px-2.5 py-1 rounded bg-[#121a24] border border-[#1f2d3e]">
                        &gt;
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right 7 cols: Automatic GPT Partitions for selected disk */}
                <div className="col-span-7 bg-[#101823] border border-[#1e2c3d] rounded-xl p-5 space-y-3">
                  <div className="text-xs font-bold tracking-wider uppercase text-[#00d4b6] mb-2">
                    ДИСК {selectedDisk.number} · {selectedDisk.model}
                  </div>

                  <div className="space-y-2.5">
                    {selectedDisk.partitions.map((part) => {
                      const isMain = part.type === 'основной';
                      const active = selectedPartitionId === part.id;
                      return (
                        <div
                          key={part.id}
                          onClick={() => setSelectedPartitionId(part.id)}
                          className={`p-3.5 rounded-lg border transition cursor-pointer flex items-center justify-between ${
                            active || isMain
                              ? 'bg-[#0e292d] border-[#00d4b6]'
                              : 'bg-[#131d2a] border-[#213042]'
                          }`}
                        >
                          <div>
                            <div className="text-sm font-bold text-white">{part.label}</div>
                            <div className="text-xs text-slate-400 font-mono mt-0.5">
                              {part.sizeGb} ГБ · {part.fs}
                            </div>
                          </div>
                          <span
                            className={`text-[11px] px-2.5 py-1 rounded font-semibold ${
                              isMain
                                ? 'bg-[#00d4b6]/20 text-[#00d4b6] border border-[#00d4b6]/30'
                                : 'bg-[#0b1118] text-slate-400 border border-[#1d2a3a]'
                            }`}
                          >
                            {part.type}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Partition Controls Bar (as shown at 0:37 in video) */}
                  <div className="pt-3 flex items-center justify-between gap-3">
                    <button
                      onClick={() => setShowPartitionModal((v) => !v)}
                      className="flex-1 py-2.5 px-4 rounded-lg bg-[#15202e] hover:bg-[#1c2a3c] border border-[#25364b] text-xs font-semibold text-slate-200 transition cursor-pointer"
                    >
                      Управление разделами
                    </button>
                    <button
                      onClick={() => setSelectedPartitionId(3)}
                      className="flex-1 py-2.5 px-4 rounded-lg bg-[#15202e] hover:bg-[#1c2a3c] border border-[#00d4b6]/40 text-xs font-semibold text-[#00d4b6] transition cursor-pointer"
                    >
                      Использовать весь диск (Авто-GPT)
                    </button>
                  </div>

                  {showPartitionModal && generatedFiles && (
                    <div className="mt-3 p-3.5 rounded-lg bg-[#0b1017] border border-[#223247] text-xs text-slate-300 space-y-2">
                      <div className="font-semibold text-white">
                        Сценарий автоматической разметки DiskPart (UEFI / GPT):
                      </div>
                      <pre className="text-[11px] font-mono text-[#00d4b6] overflow-x-auto">
                        {generatedFiles.diskpartScript}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer buttons */}
            <div className="flex items-center justify-between pt-6 border-t border-[#182230]">
              <button
                onClick={() => setCurrentStep(2)}
                className="px-7 py-3 rounded-lg bg-[#151f2c] hover:bg-[#1c293a] border border-[#253549] text-sm font-semibold text-slate-200 cursor-pointer"
              >
                Назад
              </button>
              <button
                onClick={() => setCurrentStep(4)}
                disabled={selectedDisk?.isUsb}
                className="px-8 py-3 rounded-lg bg-[#00d4b6] hover:bg-[#00e6c5] disabled:opacity-40 text-slate-950 font-bold text-sm shadow-[0_0_20px_rgba(0,212,182,0.3)] cursor-pointer"
              >
                Далее
              </button>
            </div>
          </div>
        )}

        {/* =====================================================================
            STEP 04: ПРОГРАММЫ, ДРАЙВЕРЫ, ТВИКИ, ПОДСВЕТКА (0:40 - 0:46 in video)
           ===================================================================== */}
        {currentStep === 4 && (
          <div className="max-w-6xl mx-auto w-full flex-1 flex flex-col justify-between">
            <div>
              <h2 className="text-3xl font-extrabold text-white tracking-tight">
                {activeCategory === 'tweaks' ? 'Твики системы' : 'Какие программы установить'}
              </h2>
              <p className="text-sm text-slate-400 mt-1 mb-5">
                {activeCategory === 'tweaks'
                  ? 'Это настройки Windows, а не установка драйверов.'
                  : 'Галочка добавляет программу. Нажмите на название, чтобы прочитать полное описание справа.'}
              </p>

              <div className="grid grid-cols-12 gap-6 items-stretch">
                {/* LEFT COLUMN (3 cols): 4 Category Tabs */}
                <div className="col-span-3 flex flex-col justify-between space-y-2.5">
                  <div className="space-y-2.5">
                    {CATALOG_CATEGORIES.map((cat) => {
                      const active = activeCategory === cat.id;
                      return (
                        <div
                          key={cat.id}
                          onClick={() => {
                            setActiveCategory(cat.id);
                            setCatalogPage(1);
                            setSearchQuery('');
                            const first = CATALOG_ITEMS[cat.id]?.[0];
                            if (first) setFocusedItemId(first.id);
                          }}
                          className={`p-3.5 rounded-xl border transition cursor-pointer ${
                            active
                              ? 'bg-[#0e292d] border-[#00d4b6] shadow-[0_0_18px_rgba(0,212,182,0.14)]'
                              : 'bg-[#111923] border-[#1f2d3d] hover:border-slate-600'
                          }`}
                        >
                          <div className="text-sm font-bold text-white">{cat.title}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                            {cat.subtitle}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-2 space-y-3">
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Всё необязательно. Добавить можно позже.
                    </p>
                    <button
                      onClick={() => setCurrentStep(3)}
                      className="w-full py-2.5 rounded-lg bg-[#151f2c] hover:bg-[#1c293a] border border-[#253549] text-xs font-semibold text-slate-200 cursor-pointer"
                    >
                      Назад
                    </button>
                  </div>
                </div>

                {/* CENTER COLUMN (5 cols): Search + Checkable Items + Pagination */}
                <div className="col-span-5 bg-[#101823] border border-[#1e2c3d] rounded-xl p-4 flex flex-col justify-between">
                  <div className="space-y-3">
                    {/* Search box */}
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setCatalogPage(1);
                        }}
                        placeholder="Поиск по названию или модели"
                        className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-[#0b1118] border border-[#223143] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-[#00d4b6]"
                      />
                    </div>

                    {/* Items list */}
                    <div className="space-y-2">
                      {visibleCatalogItems.map((item) => {
                        const checked = selectedItems.includes(item.id);
                        const focused = focusedItem?.id === item.id;
                        return (
                          <div
                            key={item.id}
                            onClick={() => setFocusedItemId(item.id)}
                            className={`p-3 rounded-lg border transition cursor-pointer ${
                              focused
                                ? 'bg-[#0e292d] border-[#00d4b6]'
                                : 'bg-[#131d2a] border-[#202f42] hover:border-slate-600'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleCatalogItem(item.id);
                                  setFocusedItemId(item.id);
                                }}
                                className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border cursor-pointer ${
                                  checked
                                    ? 'bg-[#00d4b6] border-[#00d4b6] text-slate-950'
                                    : 'border-slate-500 bg-[#0b1118]'
                                }`}
                              >
                                {checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                              </button>

                              <span
                                className={`w-7 h-7 rounded-md text-[10px] font-extrabold flex items-center justify-center shrink-0 ${item.badgeColor}`}
                              >
                                {item.badge}
                              </span>

                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-bold text-white truncate">
                                  {item.title}
                                </div>
                                <div className="text-[11px] text-slate-400 truncate">
                                  {item.shortDesc}
                                </div>
                              </div>
                            </div>

                            {/* Special sub-selector for CPU tweak (shown at 0:46 in video) */}
                            {item.id === 'tweak_cpu' && (
                              <div className="grid grid-cols-3 gap-2 mt-2.5 pt-2 border-t border-[#1e353d]">
                                {['auto', 'amd', 'intel'].map((mode) => (
                                  <button
                                    key={mode}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCpuVendorMode(mode);
                                    }}
                                    className={`py-1 rounded text-xs font-semibold uppercase transition cursor-pointer ${
                                      cpuVendorMode === mode
                                        ? 'bg-[#00d4b6] text-slate-950 font-bold'
                                        : 'bg-[#0c141d] text-slate-300 border border-[#243447]'
                                    }`}
                                  >
                                    {mode === 'auto' ? 'Авто' : mode.toUpperCase()}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Pagination bar */}
                  <div className="pt-3 mt-3 border-t border-[#1a2636] flex items-center justify-between text-xs text-slate-400">
                    <button
                      onClick={() => setCatalogPage((p) => Math.max(1, p - 1))}
                      disabled={safeCatalogPage <= 1}
                      className="px-3 py-1.5 rounded bg-[#141e2b] hover:bg-[#1c2a3c] disabled:opacity-40 border border-[#243447] cursor-pointer"
                    >
                      &lt;
                    </button>
                    <span className="font-mono">
                      {safeCatalogPage} / {totalCatalogPages} · выбрано {selectedInActiveCategoryCount}
                    </span>
                    <button
                      onClick={() => setCatalogPage((p) => Math.min(totalCatalogPages, p + 1))}
                      disabled={safeCatalogPage >= totalCatalogPages}
                      className="px-3 py-1.5 rounded bg-[#141e2b] hover:bg-[#1c2a3c] disabled:opacity-40 border border-[#243447] cursor-pointer"
                    >
                      &gt;
                    </button>
                  </div>
                </div>

                {/* RIGHT COLUMN (4 cols): Detailed Description Panel */}
                <div className="col-span-4 bg-[#101823] border border-[#1e2c3d] rounded-xl p-5 flex flex-col justify-between">
                  {focusedItem ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-10 h-10 rounded-lg text-xs font-black flex items-center justify-center shrink-0 ${focusedItem.badgeColor}`}
                        >
                          {focusedItem.badge}
                        </span>
                        <div>
                          <h3 className="text-lg font-extrabold text-white leading-snug">
                            {focusedItem.title}
                          </h3>
                          <span className="text-[11px] font-mono text-[#00d4b6]">
                            {focusedItem.wingetId
                              ? `winget: ${focusedItem.wingetId}`
                              : focusedItem.offlineInstaller
                              ? `offline: ${focusedItem.offlineInstaller}`
                              : 'Системный компонент / Реестр'}
                          </span>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-lg bg-[#0c121a] border border-[#1b2838] text-xs text-slate-200 font-medium">
                        {focusedItem.shortDesc}
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed">
                        {focusedItem.fullDesc}
                      </p>
                    </div>
                  ) : null}

                  <div className="space-y-3 pt-4 border-t border-[#1a2636]">
                    {focusedItem && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-400 font-mono">Описание 1 / 1</span>
                        <button
                          onClick={() => toggleCatalogItem(focusedItem.id)}
                          className={`px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                            selectedItems.includes(focusedItem.id)
                              ? 'bg-[#172331] hover:bg-rose-950/60 text-slate-200 border border-[#2a3c52]'
                              : 'bg-[#00d4b6]/20 text-[#00d4b6] border border-[#00d4b6]/40'
                          }`}
                        >
                          {selectedItems.includes(focusedItem.id) ? 'Убрать' : 'Добавить'}
                        </button>
                      </div>
                    )}

                    <button
                      onClick={() => setCurrentStep(5)}
                      className="w-full py-3 rounded-lg bg-[#00d4b6] hover:bg-[#00e6c5] text-slate-950 font-bold text-sm shadow-[0_0_20px_rgba(0,212,182,0.3)] cursor-pointer"
                    >
                      Далее
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            STEP 05: НАСТРОЙКИ ПОЛЬЗОВАТЕЛЯ (0:48 - 0:55 in video)
           ===================================================================== */}
        {currentStep === 5 && (
          <div className="max-w-5xl mx-auto w-full flex-1 flex flex-col justify-between">
            <div>
              <h2 className="text-3xl font-extrabold text-white tracking-tight">
                Настройки пользователя
              </h2>
              <p className="text-sm text-slate-400 mt-1 mb-5">
                Выбирайте только нужное. Номер заказа можно указать или пропустить после первого входа.
              </p>

              {/* Username input block */}
              <div className="bg-[#111924] border border-[#1f2d3e] rounded-xl p-4 mb-4">
                <label className="block text-xs text-slate-400 mb-1.5">
                  Имя пользователя Windows
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onBlur={() => {
                    if (!username.trim()) {
                      setUsername(defaultBranding.defaultUsername || 'Fosters');
                    }
                  }}
                  placeholder="Fosters"
                  className="w-full px-4 py-2.5 rounded-lg bg-[#0b1017] border border-[#253548] text-white font-semibold text-sm focus:outline-none focus:border-[#00d4b6]"
                />
              </div>

              {/* Checkboxes list */}
              <div className="space-y-2.5">
                {visibleSettings.map((opt) => {
                  const checked = selectedUserSettings.includes(opt.id);
                  return (
                    <div
                      key={opt.id}
                      onClick={() => toggleUserSetting(opt.id)}
                      className={`p-4 rounded-xl border transition cursor-pointer flex items-center gap-4 ${
                        checked
                          ? 'bg-[#0e292d] border-[#00d4b6]'
                          : 'bg-[#111924] border-[#1f2d3e] hover:border-slate-600'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border ${
                          checked
                            ? 'bg-[#00d4b6] border-[#00d4b6] text-slate-950'
                            : 'border-slate-500 bg-[#0b1017]'
                        }`}
                      >
                        {checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-bold text-white">{opt.title}</div>
                        <div className="text-xs text-slate-300 mt-0.5">{opt.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination bar */}
              <div className="flex items-center justify-between pt-4 text-xs text-slate-400">
                <button
                  onClick={() => setSettingsPage((p) => Math.max(1, p - 1))}
                  disabled={settingsPage <= 1}
                  className="px-3.5 py-2 rounded-lg bg-[#141e2b] hover:bg-[#1c2a3c] disabled:opacity-40 border border-[#243447] cursor-pointer"
                >
                  &lt;
                </button>
                <span className="font-mono">
                  {settingsPage} / {totalSettingsPages} · выбрано {selectedUserSettings.length}
                </span>
                <button
                  onClick={() => setSettingsPage((p) => Math.min(totalSettingsPages, p + 1))}
                  disabled={settingsPage >= totalSettingsPages}
                  className="px-3.5 py-2 rounded-lg bg-[#141e2b] hover:bg-[#1c2a3c] disabled:opacity-40 border border-[#243447] cursor-pointer"
                >
                  &gt;
                </button>
              </div>
            </div>

            {/* Footer buttons */}
            <div className="flex items-center justify-between pt-5 border-t border-[#182230]">
              <button
                onClick={() => setCurrentStep(4)}
                className="px-7 py-3 rounded-lg bg-[#151f2c] hover:bg-[#1c293a] border border-[#253549] text-sm font-semibold text-slate-200 cursor-pointer"
              >
                Назад
              </button>
              <button
                onClick={() => setCurrentStep(6)}
                className="px-8 py-3 rounded-lg bg-[#00d4b6] hover:bg-[#00e6c5] text-slate-950 font-bold text-sm shadow-[0_0_20px_rgba(0,212,182,0.3)] cursor-pointer"
              >
                Далее
              </button>
            </div>
          </div>
        )}

        {/* =====================================================================
            STEP 06: ПРОВЕРКА ПЕРЕД УСТАНОВКОЙ + ГЕНЕРАТОР ФАЙЛОВ ФЛЕШКИ
           ===================================================================== */}
        {currentStep === 6 && (
          <div className="max-w-6xl mx-auto w-full flex-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-3xl font-extrabold text-white tracking-tight">
                    Проверка конфигурации перед установкой
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Проверьте выбранные параметры или экспортируйте готовые скрипты (`autounattend.xml` + PowerShell) для флешки.
                  </p>
                </div>

                {/* View switcher tabs */}
                <div className="flex items-center gap-1.5 bg-[#101722] p-1 rounded-lg border border-[#1f2d3e]">
                  {[
                    { id: 'summary', label: 'Сводка' },
                    { id: 'unattend', label: 'autounattend.xml' },
                    { id: 'postps1', label: 'post-install.ps1' },
                    { id: 'diskpart', label: 'diskpart.txt' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveCodeTab(tab.id)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
                        activeCodeTab === tab.id
                          ? 'bg-[#00d4b6] text-slate-950 font-bold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {activeCodeTab === 'summary' ? (
                <div className="grid grid-cols-12 gap-5">
                  <div className="col-span-4 bg-[#111924] border border-[#1f2d3e] rounded-xl p-5 space-y-3">
                    <div className="text-xs font-bold uppercase tracking-wider text-[#00d4b6]">
                      1. Система и оформление
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between py-1.5 border-b border-[#1b2736]">
                        <span className="text-slate-400">Профиль Windows:</span>
                        <span className="font-bold text-white">
                          {selectedProfile.title.split('—')[0]}
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-[#1b2736]">
                        <span className="text-slate-400">Тема оформления:</span>
                        <span className="font-bold text-white">{selectedTheme.title}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-[#1b2736]">
                        <span className="text-slate-400">Режим цвета:</span>
                        <span className="font-bold text-white">
                          {colorMode === 'dark' ? 'Тёмный' : 'Светлый'}
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-[#1b2736]">
                        <span className="text-slate-400">Режим ЦП:</span>
                        <span className="font-bold text-white uppercase">{cpuVendorMode}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-[#1b2736]">
                        <span className="text-slate-400">Пользователь:</span>
                        <span className="font-bold text-[#00d4b6]">{username || 'Fosters'}</span>
                      </div>
                      <div className="flex justify-between py-1.5">
                        <span className="text-slate-400">Целевой диск:</span>
                        <span className="font-bold text-white">
                          Диск {selectedDisk.number} ({selectedDisk.sizeGb} ГБ)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="col-span-4 bg-[#111924] border border-[#1f2d3e] rounded-xl p-5 space-y-3">
                    <div className="text-xs font-bold uppercase tracking-wider text-[#00d4b6]">
                      2. Программы и драйверы ({selectedItems.length})
                    </div>
                    <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                      {allItemsFlat
                        .filter((i) => selectedItems.includes(i.id))
                        .map((item) => (
                          <div
                            key={item.id}
                            className="text-xs flex items-center justify-between py-1 px-2 rounded bg-[#0c121a] border border-[#1a2534]"
                          >
                            <span className="text-slate-200 font-medium truncate">{item.title}</span>
                            <span className="text-[10px] font-mono text-[#00d4b6] ml-2">
                              {item.badge}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="col-span-4 bg-[#111924] border border-[#1f2d3e] rounded-xl p-5 flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="text-xs font-bold uppercase tracking-wider text-[#00d4b6]">
                        3. Экспорт на флешку
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        Сохраните готовый комплект автоматической установки (`autounattend.xml`,
                        скрипт разметки `diskpart`, твикер первого входа `$OEM$`, структуру офлайн-драйверов
                        `$WinPEDriver$` и обои тем) на вашу флешку с Windows 11.
                      </p>

                      {exportStatus && (
                        <div
                          className={`p-3 rounded-lg text-xs border ${
                            exportStatus.ok
                              ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                              : 'bg-rose-950/50 border-rose-500/40 text-rose-200'
                          }`}
                        >
                          {exportStatus.ok ? (
                            <div className="space-y-1.5">
                              <div className="font-bold">Файлы успешно сохранены:</div>
                              <div className="font-mono text-[11px] break-all">
                                {exportStatus.path}
                              </div>
                              {window.rescueApi?.openExportFolder && (
                                <button
                                  onClick={() => window.rescueApi.openExportFolder()}
                                  className="mt-1 inline-flex items-center gap-1.5 text-[#00d4b6] hover:underline font-semibold cursor-pointer"
                                >
                                  <FolderOpen className="w-3.5 h-3.5" /> Открыть папку в Проводнике
                                </button>
                              )}
                            </div>
                          ) : (
                            <div>{exportStatus.error}</div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 pt-3">
                      <button
                        onClick={() => handleExportBundle(false)}
                        className="w-full py-2.5 px-4 rounded-lg bg-[#162231] hover:bg-[#1e2e42] border border-[#00d4b6]/50 text-xs font-bold text-[#00d4b6] flex items-center justify-center gap-2 transition cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                        Сохранить комплект в папку проекта (usb-export)
                      </button>
                      <button
                        onClick={() => handleExportBundle(true)}
                        className="w-full py-2.5 px-4 rounded-lg bg-[#141e2b] hover:bg-[#1b2838] border border-[#253549] text-xs font-semibold text-slate-200 flex items-center justify-center gap-2 transition cursor-pointer"
                      >
                        <Usb className="w-4 h-4 text-[#00d4b6]" />
                        Выбрать USB-флешку для записи...
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-[#0c1118] border border-[#1f2d3e] rounded-xl p-4 h-[340px] flex flex-col">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#1a2534] text-xs text-slate-400 font-mono">
                    <span>
                      {activeCodeTab === 'unattend' &&
                        'autounattend.xml (корень установочной флешки Windows 11)'}
                      {activeCodeTab === 'postps1' &&
                        '$OEM$/$$/Setup/Scripts/post-install-tweaks.ps1 (автозапуск при первом входе)'}
                      {activeCodeTab === 'diskpart' &&
                        'RescueUSB/diskpart-script.txt (разметка UEFI/GPT)'}
                    </span>
                    <button
                      onClick={() => handleExportBundle(false)}
                      className="text-[#00d4b6] hover:underline cursor-pointer"
                    >
                      Сохранить все файлы на диск
                    </button>
                  </div>
                  <pre className="flex-1 overflow-auto text-[11px] font-mono text-emerald-300 leading-relaxed select-text">
                    {activeCodeTab === 'unattend' && generatedFiles?.autounattendXml}
                    {activeCodeTab === 'postps1' && generatedFiles?.postInstallScript}
                    {activeCodeTab === 'diskpart' && generatedFiles?.diskpartScript}
                  </pre>
                </div>
              )}
            </div>

            {/* Footer buttons */}
            <div className="flex items-center justify-between pt-5 border-t border-[#182230]">
              <button
                onClick={() => setCurrentStep(5)}
                className="px-7 py-3 rounded-lg bg-[#151f2c] hover:bg-[#1c293a] border border-[#253549] text-sm font-semibold text-slate-200 cursor-pointer"
              >
                Назад
              </button>
              {/* [ERR-04] Wait for async export before transitioning to Step 7 */}
              <button
                onClick={async () => {
                  const ok = await handleExportBundle(false);
                  if (ok) setCurrentStep(7);
                }}
                className="px-8 py-3 rounded-lg bg-[#00d4b6] hover:bg-[#00e6c5] text-slate-950 font-bold text-sm shadow-[0_0_20px_rgba(0,212,182,0.3)] flex items-center gap-2 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                Начать установку
              </button>
            </div>
          </div>
        )}

        {/* =====================================================================
            STEP 07: УСТАНОВКА И ПОДГОТОВКА ПРОФИЛЯ WINDOWS (0:56 - 0:58 in video)
           ===================================================================== */}
        {currentStep === 7 && (
          <div className="max-w-5xl mx-auto w-full flex-1 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-slate-400">
                Демонстрация этапов установки (вы можете переключать вид между этапом WinPE и окном первого запуска из финала видео):
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setInstallPhase('firstlogon');
                    setInstallProgress(32);
                  }}
                  className={`px-3 py-1.5 rounded text-xs font-semibold cursor-pointer ${
                    installPhase === 'firstlogon'
                      ? 'bg-[#00d4b6] text-slate-950 font-bold'
                      : 'bg-[#141e2b] text-slate-300'
                  }`}
                >
                  Окно «Подготовка профиля» (как на 0:57)
                </button>
                <button
                  onClick={() => {
                    setInstallPhase('winpe');
                    setInstallProgress(24);
                  }}
                  className={`px-3 py-1.5 rounded text-xs font-semibold cursor-pointer ${
                    installPhase === 'winpe'
                      ? 'bg-[#00d4b6] text-slate-950 font-bold'
                      : 'bg-[#141e2b] text-slate-300'
                  }`}
                >
                  Этап 1: Развёртывание образа в WinPE
                </button>
              </div>
            </div>

            {installPhase === 'firstlogon' ? (
              /* EXACT WHITE POST-INSTALL WINDOW ON TOP OF WINDOWS 11 DESKTOP (0:57 - 0:58 in video) */
              <div className="relative rounded-2xl overflow-hidden border border-slate-700 shadow-2xl bg-gradient-to-br from-sky-200 via-blue-100 to-indigo-200 p-10 flex items-center justify-center min-h-[420px]">
                <div className="bg-white text-slate-900 rounded-2xl shadow-[0_25px_70px_rgba(0,0,0,0.25)] border border-slate-200 p-8 w-full max-w-3xl">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-9 h-9 rounded-lg bg-teal-50 border border-teal-300 flex items-center justify-center">
                      <Layers className="w-5 h-5 text-teal-600" />
                    </div>
                    <div>
                      <div className="text-base font-black tracking-wider text-slate-900 uppercase leading-none">
                        {effectiveBrandName}
                      </div>
                      <div className="text-[9px] font-bold tracking-[0.25em] text-teal-600 uppercase mt-0.5">
                        {tagline}
                      </div>
                    </div>
                  </div>

                  <div className="text-xs font-semibold text-slate-500 mb-1">
                    Подготовка рабочего окружения
                  </div>
                  <h3 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-2">
                    Подготавливаем профиль Windows
                  </h3>
                  <p className="text-xs text-slate-600 mb-6">{installSubStatus}</p>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-teal-700 mb-2">
                      <span>ЭТАП ПОДГОТОВКИ WINDOWS</span>
                      <span className="font-mono text-slate-700">{installProgress}%</span>
                    </div>

                    <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden mb-3">
                      <div
                        className="h-full bg-gradient-to-r from-teal-500 to-emerald-400 transition-all duration-500"
                        style={{ width: `${installProgress}%` }}
                      />
                    </div>

                    <div className="text-xs text-slate-500">
                      После этого откроется подтверждённая установка программ ({selectedItems.length}{' '}
                      выбрано)
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* DARK WINPE DISM IMAGE APPLY VIEW */
              <div className="bg-[#101823] border border-[#1f2d3e] rounded-xl p-8 space-y-6 my-auto">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-[#00d4b6] mb-1">
                      WinPE 11 · DISM /Apply-Image
                    </div>
                    <h3 className="text-2xl font-extrabold text-white">
                      Установка Windows 11 ({selectedProfile.title.split('—')[0]}) на Диск{' '}
                      {selectedDisk.number}
                    </h3>
                  </div>
                  <span className="text-2xl font-mono font-bold text-[#00d4b6]">
                    {installProgress}%
                  </span>
                </div>

                <div className="w-full h-3 bg-[#0b1017] rounded-full overflow-hidden border border-[#1f2d3e]">
                  <div
                    className="h-full bg-[#00d4b6] shadow-[0_0_15px_#00d4b6] transition-all duration-500"
                    style={{ width: `${installProgress}%` }}
                  />
                </div>

                <div className="bg-[#0b1017] border border-[#1b2736] rounded-lg p-4 font-mono text-xs text-slate-300 space-y-1.5">
                  <div className="text-emerald-400">
                    [OK] DiskPart: Созданы разделы EFI (300 МБ FAT32), MSR (16 МБ), Primary C: (NTFS)
                  </div>
                  <div className="text-emerald-400">
                    [OK] DISM: Автопоиск и применение образа sources\install.wim / install.esd
                  </div>
                  <div className="text-[#00d4b6]">
                    [..] Интеграция W:\Windows\Panther\unattend.xml (specialize/oobeSystem) и скрипта FirstLogonCommands...
                  </div>
                  <div className="text-slate-400">
                    [..] Запись загрузчика UEFI: bcdboot W:\Windows /s S: /f UEFI /l ru-ru
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-5 border-t border-[#182230]">
              <button
                onClick={() => setCurrentStep(6)}
                className="px-7 py-3 rounded-lg bg-[#151f2c] hover:bg-[#1c293a] border border-[#253549] text-sm font-semibold text-slate-200 cursor-pointer"
              >
                Назад
              </button>
              <button
                onClick={() => setCurrentStep(8)}
                className="px-8 py-3 rounded-lg bg-[#00d4b6] hover:bg-[#00e6c5] text-slate-950 font-bold text-sm shadow-[0_0_20px_rgba(0,212,182,0.3)] cursor-pointer"
              >
                Завершить и перейти к итогу
              </button>
            </div>
          </div>
        )}

        {/* =====================================================================
            STEP 08: ГОТОВО
           ===================================================================== */}
        {currentStep === 8 && (
          <div className="max-w-5xl mx-auto w-full my-auto bg-[#111924] border border-[#1f2d3e] rounded-2xl p-8 space-y-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#00d4b6]/15 text-[#00d4b6] border border-[#00d4b6]/30">
                  КОМПЛЕКТ ФЛЕШКИ-СПАСИТЕЛЯ ГОТОВ
                </span>
                <h2 className="text-3xl font-extrabold text-white mt-3">
                  Ваш установщик Windows 11 собран и готов к работе
                </h2>
                <p className="text-sm text-slate-300 mt-1">
                  Все конфигурационные файлы для загрузочной флешки сгенерированы по вашим выборам в
                  мастере.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-[#0c121a] border border-[#1d2a3a] space-y-2">
                <div className="font-bold text-[#00d4b6] uppercase tracking-wider">
                  Способ 1: Автоматическая установка со стандартной флешки Windows 11
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Скопируйте содержимое папки <code className="text-white">usb-export</code> прямо в
                  корень любой установочной флешки Windows 11 (Rufus, Ventoy, Media Creation Tool).
                  Папка <code className="text-white">$WinPEDriver$</code> подтянет драйверы сети,{' '}
                  <code className="text-white">autounattend.xml</code> разметит диск и обойдёт OOBE,
                  а <code className="text-white">$OEM$</code> запустит{' '}
                  <code className="text-white">post-install-tweaks.ps1</code>.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#0c121a] border border-[#1d2a3a] space-y-2">
                <div className="font-bold text-[#00d4b6] uppercase tracking-wider">
                  Способ 2: Запуск этого графического меню прямо внутри WinPE (как в ролике)
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Соберите портативный <code className="text-white">win-rescue-usb.exe</code> (
                  <code className="text-white">npm run dist:portable</code>), поместите его в{' '}
                  <code className="text-white">RescueUSB\</code> на флешке и запустите{' '}
                  <code className="text-white">scripts\inject-boot-wim.ps1</code> для интеграции в{' '}
                  <code className="text-white">sources\boot.wim</code>.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-[#1c2838]">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleExportBundle(false)}
                  className="px-6 py-3 rounded-lg bg-[#00d4b6] hover:bg-[#00e6c5] text-slate-950 font-bold text-sm flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Экспортировать файлы в usb-export
                </button>
                <button
                  onClick={() => handleExportBundle(true)}
                  className="px-5 py-3 rounded-lg bg-[#162231] hover:bg-[#1e2e42] border border-[#2a3c52] text-slate-200 font-semibold text-sm flex items-center gap-2 cursor-pointer"
                >
                  <Usb className="w-4 h-4 text-[#00d4b6]" />
                  Записать напрямую на флешку...
                </button>
              </div>

              <button
                onClick={() => setCurrentStep(1)}
                className="px-5 py-3 rounded-lg bg-[#141e2b] hover:bg-[#1b2838] border border-[#243447] text-xs font-semibold text-slate-300 cursor-pointer"
              >
                В начало мастера
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
