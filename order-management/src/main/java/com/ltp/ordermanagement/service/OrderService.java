package com.ltp.ordermanagement.service;

import com.ltp.ordermanagement.CartItem;
import com.ltp.ordermanagement.model.InventoryResponse;
import com.ltp.ordermanagement.model.Product;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.DistributionSummary;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class OrderService {

    private final RestTemplate restTemplate;
    private final Map<Long, List<CartItem>> userCarts = new HashMap<>();
    private final MeterRegistry meterRegistry;

    @Value("${PRODUCT_INVENTORY_API_HOST}")
    private String productInventoryApiHost;

    @Value("${PRODUCT_CATALOG_API_HOST}")
    private String productCatalogApiHost;

    @Value("${SHIPPING_HANDLING_API_HOST}")
    private String shippingHandlingApiHost;

    // -------------------- Business metrics --------------------
    private final Counter cartAddSuccess;
    private final Counter cartAddAlreadyInCart;
    private final Counter cartAddOutOfStock;
    private final Counter cartAddInventoryError;
    private final Counter cartAddCatalogError;

    private final Counter purchaseSuccess;
    private final Counter purchaseInventoryError;

    private final DistributionSummary cartItemsSummary;
    private final DistributionSummary cartValueSummary;

    // External dependency latency (low-cardinality labels)
    // operation: inventory_get | catalog_get | shipping_get | inventory_order_post
    // target: product-inventory | product-catalog | shipping-and-handling
    // result: success | error | not_found
    private Timer externalCallTimer(String operation, String target, String result) {
        return Timer.builder("order_management_external_call_duration_seconds")
                .description("Duration of calls to external dependencies in seconds")
                .publishPercentiles(0.5, 0.95, 0.99)
                .publishPercentileHistogram()
                .tag("operation", operation)
                .tag("target", target)
                .tag("result", result)
                .register(meterRegistry);
    }

    @Autowired
    public OrderService(RestTemplate restTemplate, MeterRegistry meterRegistry) {
        this.restTemplate = restTemplate;
        this.meterRegistry = meterRegistry;

        // cart add metrics
        this.cartAddSuccess = Counter.builder("order_management_cart_add_total")
                .description("Total add-to-cart attempts by result")
                .tag("result", "success")
                .register(meterRegistry);

        this.cartAddAlreadyInCart = Counter.builder("order_management_cart_add_total")
                .description("Total add-to-cart attempts by result")
                .tag("result", "already_in_cart")
                .register(meterRegistry);

        this.cartAddOutOfStock = Counter.builder("order_management_cart_add_total")
                .description("Total add-to-cart attempts by result")
                .tag("result", "out_of_stock")
                .register(meterRegistry);

        this.cartAddInventoryError = Counter.builder("order_management_cart_add_total")
                .description("Total add-to-cart attempts by result")
                .tag("result", "inventory_error")
                .register(meterRegistry);

        this.cartAddCatalogError = Counter.builder("order_management_cart_add_total")
                .description("Total add-to-cart attempts by result")
                .tag("result", "catalog_error")
                .register(meterRegistry);

        // purchase metrics
        this.purchaseSuccess = Counter.builder("order_management_purchase_total")
                .description("Total purchases by result")
                .tag("result", "success")
                .register(meterRegistry);

        this.purchaseInventoryError = Counter.builder("order_management_purchase_total")
                .description("Total purchases by result")
                .tag("result", "inventory_error")
                .register(meterRegistry);

        // cart distribution summaries (great for dashboards)
        this.cartItemsSummary = DistributionSummary.builder("order_management_cart_items_summary")
                .description("Number of items in cart during key operations")
                .publishPercentileHistogram()
                .register(meterRegistry);

        this.cartValueSummary = DistributionSummary.builder("order_management_cart_value_summary")
                .description("Cart total value (subtotal + shipping) during key operations")
                .baseUnit("currency_units")
                .publishPercentileHistogram()
                .register(meterRegistry);
    }

    public String addToCart(Long userId, Product product) {
        List<CartItem> cart = getUserCart(userId);

        if (cart.stream().anyMatch(item -> item.getProductId().equals(product.getId()))) {
            cartAddAlreadyInCart.increment();
            return "Product already exists in the cart";
        }

        // ---- Inventory check
        InventoryResponse inventoryResponse;
        try {
            Timer invTimer = externalCallTimer("inventory_get", "product-inventory", "success");
            inventoryResponse = invTimer.record(() ->
                    restTemplate.getForObject(
                            productInventoryApiHost + ":3002/api/inventory/" + product.getId(),
                            InventoryResponse.class
                    )
            );
        } catch (RestClientException ex) {
            externalCallTimer("inventory_get", "product-inventory", "error").record(() -> {});
            cartAddInventoryError.increment();
            return "Inventory service error";
        }

        if (inventoryResponse == null || inventoryResponse.getQuantity() <= 0) {
            cartAddOutOfStock.increment();
            return "Product is out of stock";
        }

        // ---- Catalog lookup
        Product productDetails;
        try {
            Timer catTimer = externalCallTimer("catalog_get", "product-catalog", "success");
            productDetails = catTimer.record(() ->
                    restTemplate.getForObject(
                            productCatalogApiHost + ":3001/api/products/" + product.getId(),
                            Product.class
                    )
            );
        } catch (RestClientException ex) {
            externalCallTimer("catalog_get", "product-catalog", "error").record(() -> {});
            cartAddCatalogError.increment();
            return "Product catalog service error";
        }

        if (productDetails == null) {
            externalCallTimer("catalog_get", "product-catalog", "not_found").record(() -> {});
            cartAddCatalogError.increment();
            return "Product not found in catalog";
        }

        CartItem cartItem = new CartItem(
                productDetails.getId(),
                1,
                productDetails.getName(),
                productDetails.getDescription(),
                productDetails.getPrice(),
                productDetails.getCategory()
        );

        cart.add(cartItem);
        saveUserCart(userId, cart);

        cartAddSuccess.increment();
        cartItemsSummary.record(cart.size());

        return "Product added to the cart";
    }

    public double getCartSubtotal(Long userId) {
        List<CartItem> cart = getUserCart(userId);

        double subtotal = cart.stream()
                .mapToDouble(item -> {
                    try {
                        Timer catTimer = externalCallTimer("catalog_get", "product-catalog", "success");
                        Product product = catTimer.record(() ->
                                restTemplate.getForObject(
                                        productCatalogApiHost + ":3001/api/products/" + item.getProductId(),
                                        Product.class
                                )
                        );
                        if (product == null) {
                            externalCallTimer("catalog_get", "product-catalog", "not_found").record(() -> {});
                            return 0;
                        }
                        return product.getPrice() * item.getQuantity();
                    } catch (RestClientException ex) {
                        externalCallTimer("catalog_get", "product-catalog", "error").record(() -> {});
                        return 0;
                    }
                })
                .sum();

        return subtotal;
    }

    public double getCartShippingTotal(Long userId) {
        List<CartItem> cart = getUserCart(userId);

        double sum = cart.stream()
                .mapToDouble(item -> {
                    try {
                        // shipping service returns Product with shippingFee in your model
                        Timer shipTimer = externalCallTimer("shipping_get", "shipping-and-handling", "success");
                        Product product = shipTimer.record(() ->
                                restTemplate.getForObject(
                                        shippingHandlingApiHost + ":8080/shipping-fee?product_id=" + item.getProductId(),
                                        Product.class
                                )
                        );
                        if (product != null) return product.getShippingFee();
                        externalCallTimer("shipping_get", "shipping-and-handling", "not_found").record(() -> {});
                        return 0;
                    } catch (RestClientException ex) {
                        externalCallTimer("shipping_get", "shipping-and-handling", "error").record(() -> {});
                        return 0;
                    }
                })
                .sum();

        return sum;
    }

    public double getCartTotal(Long userId) {
        double subtotal = getCartSubtotal(userId);
        double shippingTotal = getCartShippingTotal(userId);
        double total = subtotal + shippingTotal;

        // Record a value you can graph (p50/p95 cart totals)
        cartValueSummary.record(total);

        return total;
    }

    public String purchaseCart(Long userId) {
        List<CartItem> cart = getUserCart(userId);

        // Record cart size at purchase time
        cartItemsSummary.record(cart.size());

        for (CartItem item : cart) {
            try {
                Timer invPostTimer = externalCallTimer("inventory_order_post", "product-inventory", "success");
                invPostTimer.record(() ->
                        restTemplate.postForObject(
                                productInventoryApiHost + ":3002/api/order/" + item.getProductId(),
                                item.getQuantity(),
                                Void.class
                        )
                );
            } catch (RestClientException ex) {
                externalCallTimer("inventory_order_post", "product-inventory", "error").record(() -> {});
                purchaseInventoryError.increment();
                return "Purchase failed: inventory service error";
            }
        }

        // Clear cart
        saveUserCart(userId, new ArrayList<>());
        purchaseSuccess.increment();

        return "Purchase completed";
    }

    // Helper method to get the user's cart from the in-memory cache
    public List<CartItem> getUserCart(Long userId) {
        return userCarts.getOrDefault(userId, new ArrayList<>());
    }

    // Helper method to save the user's cart to the in-memory cache
    private void saveUserCart(Long userId, List<CartItem> cart) {
        userCarts.put(userId, cart);
    }
}
