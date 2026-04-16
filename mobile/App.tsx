import Mapbox from "@rnmapbox/maps";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Purchases, { LOG_LEVEL, PurchasesPackage } from "react-native-purchases";
import {
  fetchHazardGuidanceInsight,
  fetchTrafficBypassSample,
  fetchWeatherRoutingInsight,
  type HazardGuidanceInsight,
  type TrafficBypassSample,
  type WeatherRoutingInsight,
} from "./services/premiumInsight";

const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN?.trim() ?? "";
const rcApiKey = process.env.EXPO_PUBLIC_RC_APPLE_API_KEY?.trim() ?? "";
const rcEntitlementId =
  process.env.EXPO_PUBLIC_RC_ENTITLEMENT_ID?.trim() ?? "pro";
const devEntitlementOverride = process.env.EXPO_PUBLIC_PRO_ENTITLED === "true";

type PremiumFeatureKey =
  | "weatherRouting"
  | "hazardGuidance"
  | "trafficBypassCompare";

const premiumFeatureLabels: Record<PremiumFeatureKey, string> = {
  weatherRouting: "Weather Routing",
  hazardGuidance: "Hazard Guidance",
  trafficBypassCompare: "Traffic Bypass Compare",
};

if (token) {
  Mapbox.setAccessToken(token);
}

const INITIAL_MAP_CENTER: [number, number] = [-94.5, 39.1];

export default function App() {
  const [isBillingReady, setIsBillingReady] = useState(false);
  const [isBillingBusy, setIsBillingBusy] = useState(false);
  const [billingStatus, setBillingStatus] = useState("");
  const [isProEntitled, setIsProEntitled] = useState(devEntitlementOverride);
  const [activePremiumFeatures, setActivePremiumFeatures] = useState<
    Record<PremiumFeatureKey, boolean>
  >({
    weatherRouting: false,
    hazardGuidance: false,
    trafficBypassCompare: false,
  });
  const canUseRevenueCat = rcApiKey.length > 0;

  const proEnabled = useMemo(
    () => devEntitlementOverride || isProEntitled,
    [devEntitlementOverride, isProEntitled]
  );
  const activePremiumCount = useMemo(
    () => Object.values(activePremiumFeatures).filter(Boolean).length,
    [activePremiumFeatures]
  );
  const mapStyleUrl = useMemo(() => {
    if (!proEnabled) {
      return "mapbox://styles/mapbox/streets-v12";
    }
    return activePremiumFeatures.trafficBypassCompare
      ? "mapbox://styles/mapbox/navigation-night-v1"
      : "mapbox://styles/mapbox/navigation-day-v1";
  }, [activePremiumFeatures.trafficBypassCompare, proEnabled]);

  const [mapCenter, setMapCenter] = useState<[number, number]>(INITIAL_MAP_CENTER);
  const [weatherInsight, setWeatherInsight] = useState<WeatherRoutingInsight | null>(
    null
  );
  const [hazardInsight, setHazardInsight] = useState<HazardGuidanceInsight | null>(null);
  const [trafficSample, setTrafficSample] = useState<TrafficBypassSample | null>(null);
  const [premiumLoading, setPremiumLoading] = useState(false);
  const [premiumError, setPremiumError] = useState<string | null>(null);
  const premiumDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runPremiumDataRefresh = useCallback(async () => {
    if (!proEnabled) {
      setWeatherInsight(null);
      setHazardInsight(null);
      setTrafficSample(null);
      setPremiumError(null);
      setPremiumLoading(false);
      return;
    }

    const wantWeather = activePremiumFeatures.weatherRouting;
    const wantHazard = activePremiumFeatures.hazardGuidance;
    const wantTraffic = activePremiumFeatures.trafficBypassCompare;

    if (!wantWeather && !wantHazard && !wantTraffic) {
      setWeatherInsight(null);
      setHazardInsight(null);
      setTrafficSample(null);
      setPremiumError(null);
      setPremiumLoading(false);
      return;
    }

    const [lng, lat] = mapCenter;
    setPremiumLoading(true);
    setPremiumError(null);

    try {
      const tasks: Promise<void>[] = [];

      if (wantWeather) {
        tasks.push(
          (async () => {
            const w = await fetchWeatherRoutingInsight(lat, lng);
            setWeatherInsight(w);
          })()
        );
      } else {
        setWeatherInsight(null);
      }

      if (wantHazard) {
        tasks.push(
          (async () => {
            const h = await fetchHazardGuidanceInsight(lat, lng);
            setHazardInsight(h);
          })()
        );
      } else {
        setHazardInsight(null);
      }

      if (wantTraffic) {
        tasks.push(
          (async () => {
            const t = await fetchTrafficBypassSample(token, lng, lat);
            setTrafficSample(t);
          })()
        );
      } else {
        setTrafficSample(null);
      }

      await Promise.all(tasks);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Premium data request failed";
      setPremiumError(msg);
    } finally {
      setPremiumLoading(false);
    }
  }, [
    activePremiumFeatures.hazardGuidance,
    activePremiumFeatures.trafficBypassCompare,
    activePremiumFeatures.weatherRouting,
    mapCenter,
    proEnabled,
  ]);

  useEffect(() => {
    let mounted = true;

    async function initializeBilling() {
      if (!canUseRevenueCat) {
        setBillingStatus(
          "Billing not configured yet. Set RevenueCat env keys to enable in-app upgrades."
        );
        return;
      }

      setIsBillingBusy(true);
      try {
        Purchases.setLogLevel(LOG_LEVEL.INFO);
        await Purchases.configure({ apiKey: rcApiKey });
        const info = await Purchases.getCustomerInfo();
        if (!mounted) {
          return;
        }
        setIsProEntitled(Boolean(info.entitlements.active[rcEntitlementId]));
        setIsBillingReady(true);
        setBillingStatus("Billing ready");
      } catch {
        if (!mounted) {
          return;
        }
        setBillingStatus("Could not initialize billing");
      } finally {
        if (mounted) {
          setIsBillingBusy(false);
        }
      }
    }

    void initializeBilling();
    return () => {
      mounted = false;
    };
  }, [canUseRevenueCat]);

  useEffect(() => {
    if (premiumDebounceRef.current) {
      clearTimeout(premiumDebounceRef.current);
    }
    premiumDebounceRef.current = setTimeout(() => {
      void runPremiumDataRefresh();
    }, 600);
    return () => {
      if (premiumDebounceRef.current) {
        clearTimeout(premiumDebounceRef.current);
      }
    };
  }, [runPremiumDataRefresh]);

  if (!token) {
    return (
      <View style={styles.centered}>
        <StatusBar style="light" />
        <Text style={styles.title}>Configuration required</Text>
        <Text style={styles.body}>
          Add <Text style={styles.mono}>EXPO_PUBLIC_MAPBOX_TOKEN</Text> to{" "}
          <Text style={styles.mono}>mobile/.env</Text> before creating release
          builds.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <StatusBar style="light" />
      <Mapbox.MapView
        style={styles.fill}
        styleURL={mapStyleUrl}
        logoEnabled={false}
        scaleBarEnabled={false}
        onMapIdle={(state) => {
          const c = state.properties.center;
          if (Array.isArray(c) && c.length >= 2) {
            const lng = Number(c[0]);
            const lat = Number(c[1]);
            if (Number.isFinite(lng) && Number.isFinite(lat)) {
              setMapCenter([lng, lat]);
            }
          }
        }}
      >
        <Mapbox.Camera zoomLevel={9} centerCoordinate={INITIAL_MAP_CENTER} />
      </Mapbox.MapView>
      <View style={styles.topTag} pointerEvents="none">
        <Text style={styles.topTagText}>StormPath</Text>
      </View>
      <View style={styles.featureDock}>
        {(
          Object.keys(premiumFeatureLabels) as Array<PremiumFeatureKey>
        ).map((featureKey) => {
          const featureOn = activePremiumFeatures[featureKey];
          return (
            <Pressable
              key={featureKey}
              style={[
                styles.featureButton,
                featureOn && styles.featureButtonOn,
                !proEnabled && styles.featureButtonLocked,
              ]}
              accessibilityRole="button"
              onPress={() => {
                if (!proEnabled) {
                  setBillingStatus(
                    `Unlock Pro to use ${premiumFeatureLabels[featureKey]}.`
                  );
                  return;
                }
                setActivePremiumFeatures((prev) => ({
                  ...prev,
                  [featureKey]: !prev[featureKey],
                }));
              }}
            >
              <Text style={styles.featureButtonText}>
                {premiumFeatureLabels[featureKey]}
              </Text>
              <Text style={styles.featureButtonSubtext}>
                {!proEnabled ? "Locked" : featureOn ? "On" : "Off"}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {proEnabled ? (
        <PremiumInsightPanel
          mapCenter={mapCenter}
          premiumLoading={premiumLoading}
          premiumError={premiumError}
          weatherInsight={weatherInsight}
          hazardInsight={hazardInsight}
          trafficSample={trafficSample}
          toggles={activePremiumFeatures}
          onRefresh={() => void runPremiumDataRefresh()}
        />
      ) : null}
      {proEnabled ? (
        <ProEnabledChip activeCount={activePremiumCount} />
      ) : (
        <ProUpsellCard
          isBusy={isBillingBusy}
          status={billingStatus}
          canPurchase={isBillingReady}
          onUpgradePress={async () => {
            await handleUpgrade({
              canUseRevenueCat,
              setIsBillingBusy,
              setBillingStatus,
              setIsProEntitled,
              rcEntitlementId,
            });
          }}
          onRestorePress={async () => {
            await handleRestore({
              canUseRevenueCat,
              setIsBillingBusy,
              setBillingStatus,
              setIsProEntitled,
              rcEntitlementId,
            });
          }}
        />
      )}
    </View>
  );
}

type PremiumInsightPanelProps = {
  mapCenter: [number, number];
  premiumLoading: boolean;
  premiumError: string | null;
  weatherInsight: WeatherRoutingInsight | null;
  hazardInsight: HazardGuidanceInsight | null;
  trafficSample: TrafficBypassSample | null;
  toggles: Record<PremiumFeatureKey, boolean>;
  onRefresh: () => void;
};

function PremiumInsightPanel({
  mapCenter,
  premiumLoading,
  premiumError,
  weatherInsight,
  hazardInsight,
  trafficSample,
  toggles,
  onRefresh,
}: PremiumInsightPanelProps) {
  const anyOn =
    toggles.weatherRouting || toggles.hazardGuidance || toggles.trafficBypassCompare;
  const [lng, lat] = mapCenter;

  return (
    <View style={styles.insightPanel}>
      <View style={styles.insightHeaderRow}>
        <Text style={styles.insightTitle}>Premium data</Text>
        {premiumLoading ? (
          <ActivityIndicator color="#93c5fd" />
        ) : (
          <Pressable
            onPress={onRefresh}
            style={styles.insightRefresh}
            accessibilityRole="button"
          >
            <Text style={styles.insightRefreshText}>Refresh</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.insightMeta} numberOfLines={1}>
        Map center {lat.toFixed(3)}, {lng.toFixed(3)}
      </Text>
      {!anyOn ? (
        <Text style={styles.insightBody}>
          Turn on Weather Routing, Hazard Guidance, or Traffic Bypass Compare to
          load gated network data.
        </Text>
      ) : null}
      {premiumError ? (
        <Text style={styles.insightError} numberOfLines={3}>
          {premiumError}
        </Text>
      ) : null}
      {toggles.weatherRouting && weatherInsight ? (
        <View style={styles.insightBlock}>
          <Text style={styles.insightLabel}>Weather routing</Text>
          <Text style={styles.insightBody} numberOfLines={2}>
            {weatherInsight.headline}
          </Text>
          <Text style={styles.insightMeta}>
            Score {weatherInsight.routeWeatherScore}/100 · via {weatherInsight.source}
          </Text>
        </View>
      ) : null}
      {toggles.hazardGuidance && hazardInsight ? (
        <View style={styles.insightBlock}>
          <Text style={styles.insightLabel}>Hazard guidance</Text>
          <Text style={styles.insightBody} numberOfLines={2}>
            {hazardInsight.headline}
          </Text>
        </View>
      ) : null}
      {toggles.trafficBypassCompare && trafficSample ? (
        <View style={styles.insightBlock}>
          <Text style={styles.insightLabel}>Traffic sample leg</Text>
          <Text style={styles.insightBody}>
            ~{trafficSample.durationMinutes.toFixed(1)} min ·{" "}
            {(trafficSample.distanceMeters / 1000).toFixed(2)} km (Mapbox
            driving-traffic)
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function ProEnabledChip({ activeCount }: { activeCount: number }) {
  return (
    <View style={styles.chip} pointerEvents="none">
      <Text style={styles.chipText}>
        Pro enabled - {activeCount} premium
        {activeCount === 1 ? " feature" : " features"} active
      </Text>
    </View>
  );
}

type ProUpsellCardProps = {
  isBusy: boolean;
  status: string;
  canPurchase: boolean;
  onUpgradePress: () => Promise<void>;
  onRestorePress: () => Promise<void>;
};

function ProUpsellCard({
  isBusy,
  status,
  canPurchase,
  onUpgradePress,
  onRestorePress,
}: ProUpsellCardProps) {
  return (
    <View style={styles.upsellCard}>
      <Text style={styles.upsellTitle}>StormPath Pro</Text>
      <Text style={styles.upsellBody}>
        Advanced weather-aware routing and hazard guidance are currently locked.
      </Text>
      {status ? <Text style={styles.statusText}>{status}</Text> : null}
      <Pressable
        style={[styles.upsellButton, (!canPurchase || isBusy) && styles.buttonDisabled]}
        accessibilityRole="button"
        onPress={() => void onUpgradePress()}
        disabled={!canPurchase || isBusy}
      >
        <Text style={styles.upsellButtonText}>
          {isBusy ? "Please wait..." : "Upgrade in app"}
        </Text>
      </Pressable>
      <Pressable
        style={[styles.restoreButton, isBusy && styles.buttonDisabled]}
        accessibilityRole="button"
        onPress={() => void onRestorePress()}
        disabled={isBusy}
      >
        <Text style={styles.restoreButtonText}>Restore purchases</Text>
      </Pressable>
    </View>
  );
}

async function handleUpgrade({
  canUseRevenueCat,
  setIsBillingBusy,
  setBillingStatus,
  setIsProEntitled,
  rcEntitlementId,
}: {
  canUseRevenueCat: boolean;
  setIsBillingBusy: (next: boolean) => void;
  setBillingStatus: (next: string) => void;
  setIsProEntitled: (next: boolean) => void;
  rcEntitlementId: string;
}) {
  if (!canUseRevenueCat) {
    setBillingStatus("Billing is not configured");
    return;
  }

  setIsBillingBusy(true);
  try {
    const offerings = await Purchases.getOfferings();
    const pkg: PurchasesPackage | null =
      offerings.current?.availablePackages?.[0] ?? null;
    if (!pkg) {
      setBillingStatus("No products found");
      return;
    }

    const purchaseResult = await Purchases.purchasePackage(pkg);
    const hasEntitlement = Boolean(
      purchaseResult.customerInfo.entitlements.active[rcEntitlementId]
    );
    setIsProEntitled(hasEntitlement);
    setBillingStatus(hasEntitlement ? "Pro unlocked" : "Purchase completed");
  } catch (error: unknown) {
    const maybeError = error as { userCancelled?: boolean } | null;
    if (maybeError?.userCancelled) {
      setBillingStatus("Purchase canceled");
    } else {
      setBillingStatus("Purchase failed");
    }
  } finally {
    setIsBillingBusy(false);
  }
}

async function handleRestore({
  canUseRevenueCat,
  setIsBillingBusy,
  setBillingStatus,
  setIsProEntitled,
  rcEntitlementId,
}: {
  canUseRevenueCat: boolean;
  setIsBillingBusy: (next: boolean) => void;
  setBillingStatus: (next: string) => void;
  setIsProEntitled: (next: boolean) => void;
  rcEntitlementId: string;
}) {
  if (!canUseRevenueCat) {
    setBillingStatus("Billing is not configured");
    return;
  }

  setIsBillingBusy(true);
  try {
    const info = await Purchases.restorePurchases();
    const hasEntitlement = Boolean(info.entitlements.active[rcEntitlementId]);
    setIsProEntitled(hasEntitlement);
    setBillingStatus(hasEntitlement ? "Pro restored" : "No purchases to restore");
  } catch {
    setBillingStatus("Restore failed");
  } finally {
    setIsBillingBusy(false);
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#0f1419" },
  centered: {
    flex: 1,
    backgroundColor: "#0f1419",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#f1f5f9",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
  },
  body: { color: "#94a3b8", fontSize: 15, lineHeight: 22 },
  mono: { fontFamily: "monospace", color: "#cbd5e1" },
  topTag: {
    position: "absolute",
    left: 12,
    top: 56,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(15,20,25,0.88)",
    borderWidth: 1,
    borderColor: "#334155",
  },
  topTagText: { color: "#f1f5f9", fontSize: 12, fontWeight: "700" },
  featureDock: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 94,
    gap: 8,
  },
  featureButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "rgba(15,20,25,0.86)",
    borderWidth: 1,
    borderColor: "#334155",
  },
  featureButtonOn: {
    borderColor: "#2563eb",
    backgroundColor: "rgba(37,99,235,0.2)",
  },
  featureButtonLocked: {
    opacity: 0.8,
  },
  featureButtonText: { color: "#f1f5f9", fontSize: 13, fontWeight: "600" },
  featureButtonSubtext: { color: "#93c5fd", fontSize: 11, marginTop: 2 },
  insightPanel: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 100,
    maxHeight: 200,
    borderRadius: 12,
    padding: 12,
    backgroundColor: "rgba(15,20,25,0.94)",
    borderWidth: 1,
    borderColor: "#334155",
    gap: 6,
  },
  insightHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  insightTitle: { color: "#f8fafc", fontSize: 14, fontWeight: "700" },
  insightRefresh: { paddingHorizontal: 8, paddingVertical: 4 },
  insightRefreshText: { color: "#93c5fd", fontSize: 13, fontWeight: "600" },
  insightLabel: { color: "#cbd5e1", fontSize: 12, fontWeight: "600" },
  insightBody: { color: "#94a3b8", fontSize: 12, lineHeight: 17 },
  insightMeta: { color: "#64748b", fontSize: 11 },
  insightError: { color: "#f87171", fontSize: 12 },
  insightBlock: { marginTop: 4, gap: 2 },
  chip: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 36,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "rgba(15,20,25,0.92)",
    borderWidth: 1,
    borderColor: "#334155",
  },
  chipText: { color: "#94a3b8", fontSize: 12, textAlign: "center" },
  upsellCard: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 36,
    borderRadius: 12,
    padding: 14,
    backgroundColor: "rgba(15,20,25,0.94)",
    borderWidth: 1,
    borderColor: "#334155",
    gap: 8,
  },
  upsellTitle: { color: "#f8fafc", fontSize: 16, fontWeight: "700" },
  upsellBody: { color: "#94a3b8", fontSize: 13, lineHeight: 19 },
  statusText: { color: "#93c5fd", fontSize: 12 },
  upsellButton: {
    marginTop: 4,
    alignSelf: "flex-start",
    backgroundColor: "#2563eb",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  restoreButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  restoreButtonText: { color: "#93c5fd", fontSize: 12, fontWeight: "600" },
  buttonDisabled: { opacity: 0.6 },
  upsellButtonText: { color: "#f8fafc", fontSize: 13, fontWeight: "600" },
});
