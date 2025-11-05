# SPX 0DTE Weekday Engine — Clean Signals (Top Label, No Background, No Regime Alert)
# CHANGELOG (2025-10-06):
# • New: Thr30 (+ alerts/levels).
# • New: ReversionRisk when ≥30 pts prints before early afternoon and ATR use is only ~50–85%.
# • Wednesday: base sizing modestly higher; continuation requires cleaner setup; emphasize fade when mid-ATR.
# • Friday: earlier stall/exit threshold (ATR > 0.60 after noon).
# • Tuesday: strong but more reversion-aware once ATR > 0.70 if the 30-pt hit was early.

# ===== Inputs =====
input ATRLength      = 14;
input Thr10          = 10.0;
input Thr20          = 20.0;
input Thr30          = 30.0;      # NEW core trigger
input ThuStickPts    = 25.0;
input ATR_LowBand    = 0.50;
input ATR_MidBand    = 0.70;
input ATR_HiBandLow  = 0.70;
input ATR_HiBandHigh = 0.90;

# Pre-open/operational
input MarketOpenTime     = 0930;   # ET=0930, CT=0830
input UseCT              = no;
input IsCPI              = no;
input BigSurprise        = no;
input EnableAlerts       = yes;

# Reversion risk window
input FadeWindowEndTime  = 1230;   # NEW: "morning" cutoff for reversion checks (ET)
input FadeATRLow         = 0.50;   # NEW: reversion window low ATR usage bound
input FadeATRHigh        = 0.85;   # NEW: reversion window high ATR usage bound

# UI toggles
input ShowPreOpenPanel   = yes;
input ShowLevels         = yes;
input ShowPromptLabel    = yes;     # legacy 'Prompt:' label (on/off)
input ShowSignalLabel    = yes;     # new consolidated 'Signal:' label
input ShowSignalMarkers  = yes;     # mark flips on chart
input Show30Levels       = yes;     # NEW: show ±30 bands

# ===== Daily series & ATR =====
def openD  = open(period = AggregationPeriod.DAY);
def highD  = high(period = AggregationPeriod.DAY);
def lowD   = low(period  = AggregationPeriod.DAY);
def closeD = close(period = AggregationPeriod.DAY);
def prevCloseD = close(period = AggregationPeriod.DAY)[1];

def TR = Max(highD - lowD,
         Max(AbsValue(highD - prevCloseD), AbsValue(lowD - prevCloseD)));
def ATR14 = Average(TR, ATRLength);

def rangeSoFar = highD - lowD;
def atrUsed    = if ATR14 != 0 then rangeSoFar / ATR14 else 0.0;
def maxFromOpen = Max(AbsValue(highD - openD), AbsValue(openD - lowD));

# ===== Time helpers =====
def secsFromOpen   = SecondsFromTime(MarketOpenTime);
def preOpen        = secsFromOpen < 0;
def afterNoon      = SecondsFromTime(1200) >= 0;
def beforeFadeEnd  = SecondsFromTime(FadeWindowEndTime) < 0;  # "morning" window

# ===== Weekday =====
def dow   = GetDayOfWeek(GetYYYYMMDD());
def isMon = dow == 2;
def isTue = dow == 3;
def isWed = dow == 4;
def isThu = dow == 5;
def isFri = dow == 6;

# ===== Threshold flags =====
def hit10    = maxFromOpen >= Thr10;
def hit20    = maxFromOpen >= Thr20;
def hit30    = maxFromOpen >= Thr30;           # NEW
def thuStick = isThu and maxFromOpen >= ThuStickPts;

# ===== Pre-open GO/NO-GO =====
def gapAbs = AbsValue(openD - prevCloseD);
def gapATR = if ATR14 != 0 then gapAbs / ATR14 else 0.0;

# UPDATED weekday base sizing (Wed boosted vs prior; Fri trimmed a touch)
def baseSize =
    if isFri then 0.90
    else if isThu then 1.00
    else if isTue then 0.90
    else if isMon then 0.50
    else if isWed then 0.60
    else 0.50;

def gapMult =
    if gapATR < 0.10 then 0.5
    else if gapATR <= 0.35 then 1.0
    else if gapATR <= 0.50 then 0.8
    else 0.6;

def eventMult =
    if IsCPI and !BigSurprise and !isThu then 0.5
    else if IsCPI and BigSurprise then 1.0
    else 1.0;

def sizeSuggest = baseSize * gapMult * eventMult;

# ===== Direction-agnostic palette (spreads) =====
DefineGlobalColor("SigBetter",   Color.GREEN);       # best conditions
DefineGlobalColor("SigGood",     Color.DARK_GREEN);  # good conditions
DefineGlobalColor("SigNotGood",  Color.PINK);        # not good / caution
DefineGlobalColor("SigBad",      Color.RED);         # bad / close

# Harmonized Prompt colors
DefineGlobalColor("PromptGo",    Color.DARK_GREEN);  # good
DefineGlobalColor("PromptLean",  Color.GREEN);       # better lean/cont
DefineGlobalColor("PromptFade",  Color.PINK);        # not good
DefineGlobalColor("PromptStop",  Color.RED);         # bad
DefineGlobalColor("PromptWait",  Color.YELLOW);      # neutral/wait)

# Pre-open label
def hardPass =
    (isWed and !BigSurprise and gapATR < 0.06) or   # slightly stricter low-gap Wed pass
    (IsCPI and !BigSurprise and !isThu) or
    (gapATR < 0.05);

def softCaution = (gapATR < 0.10) or (gapATR > 0.50) or isMon;

AddLabel(ShowPreOpenPanel and preOpen,
    "Pre-Open (" + (if UseCT then "CT " else "ET ") + AsText(MarketOpenTime) + "): " +
    (if hardPass then "PASS"
     else if sizeSuggest >= 0.9 then "GO"
     else "SIZE DOWN")
    + " | Weekday=" +
    (if isMon then "Mon" else if isTue then "Tue" else if isWed then "Wed" else if isThu then "Thu" else if isFri then "Fri" else "N/A")
    + " | Gap=" + AsPercent(gapATR) + " of ATR | Size≈" + Round(sizeSuggest * 100, 0) + "%",
    (if hardPass then GlobalColor("SigBad")
     else if softCaution or sizeSuggest < 0.9 then GlobalColor("SigNotGood")
     else GlobalColor("SigBetter")));

# ===== Intraday logic; NO background, NO regime change alert =====
DefineGlobalColor("Standby", Color.YELLOW);
DefineGlobalColor("Fade", Color.RED);
DefineGlobalColor("ShallowCont", Color.CYAN);
DefineGlobalColor("Continuation", Color.GREEN);
DefineGlobalColor("StallClose", Color.GRAY);

# UPDATED: regime logic by weekday (reflect current tendencies)

# Monday — quiet bias unchanged
def regimeCodeMon =
    if atrUsed < ATR_LowBand then 0
    else if atrUsed < ATR_MidBand then 1
    else if hit20 then 2
    else 0;

# Tuesday — strong but reversion-prone if early ATR spent
def regimeCodeTue =
    if atrUsed < 0.65 then (if hit10 then 3 else 0)      # earlier shallow continuation window
    else if atrUsed > 0.85 then 4                        # stall/exit when stretched
    else if hit20 then 2 else 0;

# Wednesday — more active, but emphasize fade in mid ATR usage
def regimeCodeWed =
    if atrUsed >= ATR_LowBand and atrUsed <= ATR_MidBand then 1
    else if atrUsed > 0.80 and atrUsed <= ATR_HiBandHigh then 1
    else if (atrUsed < 0.60 and hit10) or hit20 then 2
    else 0;

# Thursday — continuation bias intact
def regimeCodeThu =
    if thuStick or hit20 then 3
    else if atrUsed < ATR_LowBand then 0
    else if hit10 then 3 else 0;

# Friday — earlier stall threshold (cooling lately)
def regimeCodeFri =
    if atrUsed < ATR_LowBand then (if hit10 then 3 else 0)
    else if atrUsed > 0.60 then 4                         # CHANGED from 0.70 → 0.60
    else if hit20 then 2 else 0;

def regimeCode =
    if isMon then regimeCodeMon
    else if isTue then regimeCodeTue
    else if isWed then regimeCodeWed
    else if isThu then regimeCodeThu
    else if isFri then regimeCodeFri
    else 0;

# ===== Reversion Risk (NEW)
# If we hit ≥30 pts before early afternoon with only partial ATR consumed, flag a fade/trim bias.
def ReversionRiskCore = hit30 and beforeFadeEnd and (atrUsed >= FadeATRLow and atrUsed <= FadeATRHigh);
def ReversionRisk =
    ReversionRiskCore and (isTue or isWed or isFri);  # focus where it matters most lately

# ===== Prompt label (palette-applied) =====
def friExitEarly = isFri and afterNoon and atrUsed > 0.60;   # CHANGED threshold
def tueCont = isTue and atrUsed < 0.65 and hit10;            # CHANGED threshold
def wedFade = isWed and (atrUsed >= ATR_LowBand and atrUsed <= ATR_HiBandHigh);
def monQuiet = isMon and atrUsed < ATR_LowBand;
def thuContStrong = isThu and (thuStick or hit20);

def promptCode =
    if ReversionRisk then 11
    else if thuContStrong then 10
    else if friExitEarly then 1
    else if tueCont then 9
    else if wedFade then 3
    else if monQuiet then 2
    else if regimeCode == 3 then 8
    else if regimeCode == 2 then 7
    else if regimeCode == 1 then 3
    else if regimeCode == 4 then 1
    else 0;

AddLabel(ShowPromptLabel and !preOpen,
    "Prompt: " +
    (if promptCode == 11 then "Reversion risk: ≥30 early & ATR ~50–85% — trim/hedge/fade edges"
     else if promptCode == 10 then "Thu: Open/Hold continuation spread (sticks ≥ " + AsPrice(ThuStickPts) + ")"
     else if promptCode == 9  then "Tue: Continuation (ATR<65% & ±10 hit)"
     else if promptCode == 8  then "Continuation: Might wanna take profits"
     else if promptCode == 7  then "Shallow continuation: We have Lift Off"
     else if promptCode == 3  then "Fade extremes / Mean reversion possible"
     else if promptCode == 2  then "Standby / Might not be your day"
     else if promptCode == 1  then "Stall/Exit: Avoid new entries, manage/close"
     else "Wait for ±10 or clearer ATR"),
    (if promptCode >= 8 then GlobalColor("PromptLean")
     else if promptCode == 7 then GlobalColor("PromptGo")
     else if promptCode == 11 or promptCode == 3 then GlobalColor("PromptFade")
     else if promptCode == 2 then GlobalColor("PromptWait")
     else if promptCode == 1 then GlobalColor("PromptStop")
     else GlobalColor("PromptWait")));

# ===== NEW: Consolidated Signal label (simple, top-of-chart)
# -2 = Stall/Exit, -1 = Fade, 0 = Standby, +1 = Shallow Cont., +2 = Continuation
DefineGlobalColor("SigCont", Color.GREEN);
DefineGlobalColor("SigShallow", Color.CYAN);
DefineGlobalColor("SigFade", Color.RED);
DefineGlobalColor("SigStandby", Color.YELLOW);  # unused for label; we draw Standby as WHITE
DefineGlobalColor("SigStall", Color.GRAY);

def signalCode =
    if ReversionRisk then -1
    else if isThu and (thuStick or hit20) then 2
    else if isFri and afterNoon and atrUsed > 0.60 then -2
    else if regimeCode == 3 then 2
    else if regimeCode == 2 then 1
    else if regimeCode == 1 then -1
    else if regimeCode == 4 then -2
    else 0;

AddLabel(ShowSignalLabel and !preOpen,
    "Signal: " +
    (if signalCode == 2 then "CONTINUATION"
     else if signalCode == 1 then "Shallow Cont."
     else if signalCode == -1 then "Fade / Reversion"
     else if signalCode == -2 then "STALL / EXIT"
     else "Standby"),
    (if signalCode == 2 then GlobalColor("SigBetter")
     else if signalCode == 1 then GlobalColor("SigGood")
     else if signalCode == -2 then GlobalColor("SigBad")
     else if signalCode == -1 then GlobalColor("SigNotGood")
     else Color.WHITE));

# Optional: show markers when signal flips (palette-applied; standby white)
def signalFlip = signalCode != signalCode[1];
AddChartBubble(ShowSignalMarkers and signalFlip, close,
    if signalCode > signalCode[1] then "▲ Signal Up" else "▼ Signal Dn",
    if signalCode == 2 then GlobalColor("SigBetter")
    else if signalCode == 1 then GlobalColor("SigGood")
    else if signalCode == -2 then GlobalColor("SigBad")
    else if signalCode == -1 then GlobalColor("SigNotGood")
    else Color.WHITE,
    signalCode <= signalCode[1]);

# ===== Levels (symmetric, direction-agnostic) =====
plot DayOpen     = if ShowLevels then openD else Double.NaN;
plot OpenPlus10  = if ShowLevels then openD + Thr10 else Double.NaN;
plot OpenMinus10 = if ShowLevels then openD - Thr10 else Double.NaN;
plot OpenPlus20  = if ShowLevels then openD + Thr20 else Double.NaN;
plot OpenMinus20 = if ShowLevels then openD - Thr20 else Double.NaN;
plot OpenPlus30  = if ShowLevels and Show30Levels then openD + Thr30 else Double.NaN;  # NEW
plot OpenMinus30 = if ShowLevels and Show30Levels then openD - Thr30 else Double.NaN;  # NEW

DayOpen.SetDefaultColor(Color.BLUE);

OpenPlus10.SetDefaultColor(Color.DARK_GREEN);
OpenPlus10.SetStyle(Curve.FIRM);
OpenMinus10.SetDefaultColor(Color.DARK_GREEN);
OpenMinus10.SetStyle(Curve.FIRM);

OpenPlus20.SetDefaultColor(Color.GREEN);
OpenPlus20.SetStyle(Curve.SHORT_DASH);
OpenMinus20.SetDefaultColor(Color.GREEN);
OpenMinus20.SetStyle(Curve.SHORT_DASH);

OpenPlus30.SetDefaultColor(Color.YELLOW);
OpenPlus30.SetStyle(Curve.LONG_DASH);
OpenMinus30.SetDefaultColor(Color.YELLOW);
OpenMinus30.SetStyle(Curve.LONG_DASH);

# ===== Info & Alerts =====
AddLabel(yes, "ATR14=" + Round(ATR14, 1) + " | Used=" + AsPercent(atrUsed) + " | MaxFromOpen=" + Round(maxFromOpen, 1) + " pts", Color.WHITE);

def hit10Now    = maxFromOpen >= Thr10 and maxFromOpen[1] < Thr10;
def hit20Now    = maxFromOpen >= Thr20 and maxFromOpen[1] < Thr20;
def hit30Now    = maxFromOpen >= Thr30 and maxFromOpen[1] < Thr30;  # NEW
def cross50     = atrUsed[1] < ATR_LowBand and atrUsed >= ATR_LowBand;
def cross70     = atrUsed[1] < ATR_MidBand and atrUsed >= ATR_MidBand;
def cross90     = atrUsed[1] < 0.90 and atrUsed >= 0.90;
def thuStickNow = isThu and maxFromOpen[1] < ThuStickPts and maxFromOpen >= ThuStickPts;
def fri60ByNoon = isFri and afterNoon and atrUsed[1] < 0.60 and atrUsed >= 0.60;  # CHANGED

Alert(EnableAlerts and hit10Now,     "Open ±10 reached",  Alert.BAR, Sound.Bell);
Alert(EnableAlerts and hit20Now,     "Open ±20 reached",  Alert.BAR, Sound.Bell);
Alert(EnableAlerts and hit30Now,     "Open ±30 reached",  Alert.BAR, Sound.Ding);                 # FIXED sound
Alert(EnableAlerts and cross50,      "ATR used crossed 50%",  Alert.BAR, Sound.Chimes);
Alert(EnableAlerts and cross70,      "ATR used crossed 70%",  Alert.BAR, Sound.Chimes);
Alert(EnableAlerts and cross90,      "ATR used crossed 90%",  Alert.BAR, Sound.Ring);
Alert(EnableAlerts and thuStickNow,  "Thursday stick zone hit (>= " + ThuStickPts + " pts)", Alert.BAR, Sound.Ding);
Alert(EnableAlerts and fri60ByNoon,  "Friday >60% ATR after noon — consider closing 0DTE spreads", Alert.BAR, Sound.Bell);

# NEW: explicit reversion alert
Alert(EnableAlerts and ReversionRisk, "Reversion risk: ≥30 early with ATR ~50–85% (trim/hedge/fade)", Alert.BAR, Sound.Ding);  # FIXED sound
