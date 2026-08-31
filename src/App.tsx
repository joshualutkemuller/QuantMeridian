import { Outlet, Route, Routes } from "react-router-dom";
import { RootLayout } from "./app/RootLayout";
import { DrillProvider } from "@/components/econ/DrillProvider";
import { isModuleEnabled } from "@/lib/moduleConfig";

// Top-level modules
import Home from "./app/page";
import Markets from "./app/markets/page";
import MarketSnapshot from "./app/market-snapshot/page";
import AssetQuilt from "./app/asset-quilt/page";
import IndexReturns from "./app/index-returns/page";
import MarketLens from "./app/market-lens/page";
import MarketChart from "./app/market-chart/page";
import MarketVolatility from "./app/market-volatility/page";
import SecuritiesLending from "./app/securities-lending/page";
import Squeeze from "./app/securities-lending/squeeze/page";
import PrimeFinance from "./app/prime-finance/page";
import Collateral from "./app/collateral/page";
import CashOptimizer from "./app/cash-optimizer/page";
import Reinvestment from "./app/reinvestment/page";
import Liquidity from "./app/liquidity/page";
import SourcesUses from "./app/sources-uses/page";
import Optimization from "./app/optimization/page";
import TradingDesk from "./app/trading-desk/page";
import TradingAssistant from "./app/trading-assistant/page";
import MacroChart from "./app/macro-chart/page";
import Polymarket from "./app/polymarket/page";
import News from "./app/news/page";
import Sentiment from "./app/sentiment/page";
import Copilot from "./app/copilot/page";
import DataOps from "./app/dataops/page";
import Alerts from "./app/alerts/page";

// Economics modules (share the DrillProvider layout)
import Economics from "./app/economics/page";
import EconCurve from "./app/economics/curve/page";
import EconInflation from "./app/economics/inflation/page";
import EconGlobalCpi from "./app/economics/global-cpi/page";
import EconPolicyRates from "./app/economics/policy-rates/page";
import EconCredit from "./app/economics/credit/page";
import EconRates from "./app/economics/rates/page";
import EconCalendar from "./app/economics/calendar/page";
import EconStats from "./app/economics/stats/page";
import EconEda from "./app/economics/eda/page";
import EconRegime from "./app/economics/regime/page";
import EconMl from "./app/economics/ml/page";
import EconSecFinance from "./app/economics/sec-finance/page";
import EconFunding from "./app/economics/funding/page";
import EconMotion from "./app/economics/motion/page";
import EconBenchmark from "./app/economics/benchmark/page";
import EconUtilization from "./app/economics/utilization/page";
import EconYieldCurve from "./app/economics/yield-curve/page";
import EconRateVol from "./app/economics/rate-vol/page";
import EconFundingCost from "./app/economics/funding-cost/page";
import EconRateAnalysis from "./app/economics/rate-analysis/page";

import NotFound from "./app/not-found";

function on(code: string) {
  return isModuleEnabled(code);
}

export function App() {
  const econChildren = [
    on("ECON") && <Route key="econ-idx" index element={<Economics />} />,
    on("CURV") && <Route key="curv" path="curve" element={<EconCurve />} />,
    on("INFL") && <Route key="infl" path="inflation" element={<EconInflation />} />,
    on("GCPI") && <Route key="gcpi" path="global-cpi" element={<EconGlobalCpi />} />,
    on("GPOL") && <Route key="gpol" path="policy-rates" element={<EconPolicyRates />} />,
    on("CRDT") && <Route key="crdt" path="credit" element={<EconCredit />} />,
    on("FOMC") && <Route key="fomc" path="rates" element={<EconRates />} />,
    on("CAL") && <Route key="cal" path="calendar" element={<EconCalendar />} />,
    on("STAT") && <Route key="stat" path="stats" element={<EconStats />} />,
    on("REGIME") && <Route key="regime" path="regime" element={<EconRegime />} />,
    on("EML") && <Route key="eml" path="ml" element={<EconMl />} />,
    on("SFE") && <Route key="sfe" path="sec-finance" element={<EconSecFinance />} />,
    on("FUND") && <Route key="fund" path="funding" element={<EconFunding />} />,
    on("MOTN") && <Route key="motn" path="motion" element={<EconMotion />} />,
    on("BMRK") && <Route key="bmrk" path="benchmark" element={<EconBenchmark />} />,
    on("UTIL") && <Route key="util" path="utilization" element={<EconUtilization />} />,
    on("YCURV") && <Route key="ycurv" path="yield-curve" element={<EconYieldCurve />} />,
    on("RVOL") && <Route key="rvol" path="rate-vol" element={<EconRateVol />} />,
    on("FCOST") && <Route key="fcost" path="funding-cost" element={<EconFundingCost />} />,
    on("BRA") && <Route key="bra" path="rate-analysis" element={<EconRateAnalysis />} />,
    on("EDA") && <Route key="eda" path="eda" element={<EconEda />} />,
  ].filter(Boolean);

  const showEcon = econChildren.length > 0;

  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route index element={<Home />} />
        {on("MKT") && <Route path="markets" element={<Markets />} />}
        {on("SNAP") && <Route path="market-snapshot" element={<MarketSnapshot />} />}
        {on("QUILT") && <Route path="asset-quilt" element={<AssetQuilt />} />}
        {on("IRET") && <Route path="index-returns" element={<IndexReturns />} />}
        {on("LENS") && <Route path="market-lens" element={<MarketLens />} />}
        {on("MKC") && <Route path="market-chart" element={<MarketChart />} />}
        {on("MVOL") && <Route path="market-volatility" element={<MarketVolatility />} />}
        {on("SLAB") && <Route path="securities-lending" element={<SecuritiesLending />} />}
        {on("SQZ") && <Route path="securities-lending/squeeze" element={<Squeeze />} />}
        {on("PB") && <Route path="prime-finance" element={<PrimeFinance />} />}
        {on("COLL") && <Route path="collateral" element={<Collateral />} />}
        {on("CASH") && <Route path="cash-optimizer" element={<CashOptimizer />} />}
        {on("REINV") && <Route path="reinvestment" element={<Reinvestment />} />}
        {on("LIQ") && <Route path="liquidity" element={<Liquidity />} />}
        {on("SXU") && <Route path="sources-uses" element={<SourcesUses />} />}
        {on("OPT") && <Route path="optimization" element={<Optimization />} />}
        {on("DESK") && <Route path="trading-desk" element={<TradingDesk />} />}
        {on("TASSIST") && <Route path="trading-assistant" element={<TradingAssistant />} />}
        {on("MGC") && <Route path="macro-chart" element={<MacroChart />} />}
        {on("POLY") && <Route path="polymarket" element={<Polymarket />} />}
        {on("NEWS") && <Route path="news" element={<News />} />}
        {on("SENT") && <Route path="sentiment" element={<Sentiment />} />}
        {on("AI") && <Route path="copilot" element={<Copilot />} />}
        {on("DATAOPS") && <Route path="dataops" element={<DataOps />} />}
        {on("ALRT") && <Route path="alerts" element={<Alerts />} />}

        {showEcon && (
          <Route
            path="economics"
            element={
              <DrillProvider>
                <EconomicsOutlet />
              </DrillProvider>
            }
          >
            {econChildren}
          </Route>
        )}

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

// Economics layout: renders its nested routes inside the shared DrillProvider.
function EconomicsOutlet() {
  return <Outlet />;
}
